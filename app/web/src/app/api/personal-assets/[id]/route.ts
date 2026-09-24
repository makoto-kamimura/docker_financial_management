import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import { badRequest, notFound } from "@/lib/api-error";
import { zYearMonth } from "@/lib/zod-helpers";
import { computeDebtSchedule } from "@/lib/debt-schedule";
import {
  serializeAssetWithDebt,
  buildDebtLoanData,
  ratePercentOf,
  manualMonthlyPaymentOf,
} from "@/lib/personal-asset-debt";
import { invalidateCache } from "@/lib/redis";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(PERSONAL_ASSET_CATEGORIES).optional(),
  acquiredOn: z.string().nullable().optional(),
  acquisitionCost: z.number().nullable().optional(),
  currentValue: z.number().optional(),
  // 純資産に評価額を計上するか。false = 負債のみ反映（ローンの諸費用等）
  countAsAsset: z.boolean().optional(),
  note: z.string().nullable().optional(),
  linkedAccountId: z.number().int().nullable().optional(),
  debtStartOn: zYearMonth.nullable().optional(), // 支払い開始年月（"YYYY-MM"）
  debtPayoffDue: zYearMonth.nullable().optional(), // 負債解消予定年月（"YYYY-MM"）
  debtInitialAmount: z.number().min(0).nullable().optional(), // 当初負債額
  // 年利（Loan.interestRate と同じ小数表記。0.0081 = 0.810%）
  debtInterestRate: z.number().min(0).max(1).nullable().optional(),
  // 残価設定ローンの据置額（最終回に一括支払い）。カーローン等
  debtResidualValue: z.number().min(0).nullable().optional(),
});

// PATCH /api/personal-assets/[id] … 実物資産の更新（editor 以上）
// D-4: 負債フィールドは Loan（loanId）へ読み替えて upsert / 削除する
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.personalAsset.findUnique({
      where: { id, tenantId },
      include: { loan: true },
    });
    if (!existing) throw notFound();

    if (body.linkedAccountId !== undefined && body.linkedAccountId !== null) {
      const account = await db.account.findFirst({
        where: { id: body.linkedAccountId, tenantId },
      });
      if (!account) throw badRequest(`invalid linkedAccountId: ${body.linkedAccountId}`);
    }

    // 更新後の開始・解消予定・当初負債額（未指定は既存 Loan の値を引き継ぐ）
    const nextStartOn =
      body.debtStartOn !== undefined ? body.debtStartOn : (existing.loan?.borrowedOn ?? null);
    const nextPayoffDue =
      body.debtPayoffDue !== undefined
        ? body.debtPayoffDue
        : (existing.loan?.repaymentDate ?? null);
    const nextInitialAmount =
      body.debtInitialAmount !== undefined
        ? body.debtInitialAmount
        : existing.loan
          ? Number(existing.loan.amount)
          : null;
    if (nextStartOn && nextPayoffDue && nextStartOn > nextPayoffDue) {
      throw badRequest("debtStartOn must be before or equal to debtPayoffDue");
    }

    const nextName = body.name ?? existing.name;
    const nextInterestRate =
      body.debtInterestRate !== undefined
        ? body.debtInterestRate
        : (Number(existing.loan?.interestRate ?? 0) ?? 0);

    const nextResidualValue =
      body.debtResidualValue !== undefined
        ? body.debtResidualValue
        : Number(existing.loan?.residualValue ?? 0);

    // 実額が入力済みの返済額は資産側の編集で潰さない（5 年ルールで計算値と一致しないため）
    const manualMonthly = manualMonthlyPaymentOf(existing.loan);

    const debtData = buildDebtLoanData(
      nextName,
      {
        debtStartOn: nextStartOn,
        debtPayoffDue: nextPayoffDue,
        debtInitialAmount: nextInitialAmount,
        debtInterestRate: nextInterestRate,
        debtResidualValue: nextResidualValue,
      },
      manualMonthly,
    );

    const asset = await db.$transaction(async (tx) => {
      let loanId: number | null | undefined;
      if (debtData) {
        if (existing.loanId) {
          await tx.loan.update({ where: { id: existing.loanId }, data: debtData });
        } else {
          const loan = await tx.loan.create({ data: { tenantId, ...debtData } });
          loanId = loan.id;
        }
      } else if (existing.loanId) {
        // 負債の 3 点セットが揃わなくなった → 紐付け負債を解消する
        loanId = null;
      }

      const updated = await tx.personalAsset.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.category !== undefined && { category: body.category }),
          ...(body.acquiredOn !== undefined && {
            acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
          }),
          ...(body.acquisitionCost !== undefined && { acquisitionCost: body.acquisitionCost }),
          ...(body.currentValue !== undefined && { currentValue: body.currentValue }),
          ...(body.countAsAsset !== undefined && { countAsAsset: body.countAsAsset }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.linkedAccountId !== undefined && { linkedAccountId: body.linkedAccountId }),
          ...(loanId !== undefined && { loanId }),
        },
        include: { loan: true },
      });
      if (loanId === null && existing.loanId) {
        await tx.loan.delete({ where: { id: existing.loanId } });
      }
      return updated;
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);
    const schedule = asset.loan
      ? computeDebtSchedule(
          Number(asset.loan.amount),
          asset.loan.borrowedOn,
          asset.loan.repaymentDate,
          new Date(),
          ratePercentOf(Number(asset.loan.interestRate)),
          manualMonthlyPaymentOf(asset.loan),
          Number(asset.loan.residualValue ?? 0),
        )
      : null;
    return NextResponse.json({ data: serializeAssetWithDebt(asset, schedule) });
  },
});

// DELETE /api/personal-assets/[id] … 実物資産の削除（editor 以上）
// 紐付け負債（Loan）も併せて削除する
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.personalAsset.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.$transaction(async (tx) => {
      await tx.personalAsset.delete({ where: { id } });
      if (existing.loanId) {
        await tx.loan.delete({ where: { id: existing.loanId } });
      }
    });
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ ok: true });
  },
});
