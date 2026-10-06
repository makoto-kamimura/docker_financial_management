import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import { badRequest, notFound } from "@/lib/api-error";
import { zYearMonth } from "@/lib/zod-helpers";
import { computeDebtSchedule } from "@/lib/debt-schedule";
import {
  buildDebtLoanData,
  ratePercentOf,
  manualMonthlyPaymentOf,
} from "@/lib/personal-asset-debt";
import { invalidateCache } from "@/lib/redis";
import {
  anchorBeforeRuleChange,
  assetInput,
  PartInputSchema,
  recordValuation,
  ruleAfter,
  ruleChanged,
  serializeAsset,
  syncParts,
  VALUATION_INCLUDE,
  valuationData,
  valuationFields,
} from "@/lib/personal-asset-valuation";

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
  // 価値の変わり方（内訳があるときは内訳ごとの設定を使う）
  ...valuationFields,
  // 内訳を入力どおりにそろえる（id のある内訳は直し、無い内訳は作り、無くなった内訳は消す）。
  // 空の配列で内訳をやめる。省略すると内訳はそのまま
  parts: z.array(PartInputSchema).max(20).optional(),
});

// PATCH /api/personal-assets/[id] … 実物資産の更新（editor 以上）
// D-4: 負債フィールドは Loan（loanId）へ読み替えて upsert / 削除する
// 評価額（資産そのもの・内訳）が変わったら、今日の日付で評価額の記録を残す（推移の見積もりの起点になる）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.personalAsset.findUnique({
      where: { id, tenantId },
      include: { loan: { include: { repayments: true } }, ...VALUATION_INCLUDE },
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

    // ローンの項目が 1 つも入っていなければ、ローンには触らない（借入金の入力は借入金管理に集めた。
    // 名前を変えただけで借入先名や月額を作り直さないため）。古い画面が送ってきたときだけ従来どおり扱う
    const debtTouched =
      body.debtStartOn !== undefined ||
      body.debtPayoffDue !== undefined ||
      body.debtInitialAmount !== undefined ||
      body.debtInterestRate !== undefined ||
      body.debtResidualValue !== undefined;
    const debtData =
      debtTouched &&
      buildDebtLoanData(
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
      } else if (debtTouched && existing.loanId) {
        // 負債の 3 点セットが揃わなくなった → 紐付け負債を解消する
        loanId = null;
      }

      // 内訳: 入力どおりにそろえ、評価額・取得価格は内訳の合計にする
      let totals: { currentValue: number; acquisitionCost: number | null } | null = null;
      if (body.parts !== undefined && (body.parts.length > 0 || existing.parts.length > 0)) {
        const t = await syncParts(tx, tenantId, id, body.parts, existing.parts, existing);
        if (body.parts.length > 0) totals = t;
      }
      const hasParts = body.parts !== undefined ? body.parts.length > 0 : existing.parts.length > 0;
      // 内訳の無い資産で価値の変わり方（自動のときは種別も）を変えたら、変える前の今日の見積もりを
      // 記録して、過ぎた月の見積もりを動かさない。評価額も同時に入れたときは、その値が優先される
      // 編集画面は評価額を毎回送るので、今と同じ値なら入れ直していないものとして扱う
      const valueEntered =
        body.currentValue !== undefined && body.currentValue !== Number(existing.currentValue);
      let anchoredValue: number | null = null;
      const nextRule = ruleAfter(existing, body);
      if (!hasParts && existing.parts.length === 0 && ruleChanged(existing, body)) {
        anchoredValue = await anchorBeforeRuleChange(
          tx,
          tenantId,
          id,
          null,
          assetInput(existing),
          nextRule,
        );
      }
      if (!hasParts) {
        // 内訳の無い資産: 評価額が変わったとき、内訳をやめたときは、資産そのものの評価額を記録する
        const nextValue = body.currentValue ?? Number(existing.currentValue);
        const leftParts = existing.parts.length > 0;
        if (leftParts || valueEntered) {
          await recordValuation(tx, tenantId, id, null, nextValue, nextRule);
        }
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
          ...valuationData(body),
          ...(anchoredValue !== null &&
            !valueEntered && {
              currentValue: anchoredValue,
            }),
          ...(totals ?? {}),
        },
        include: { loan: { include: { repayments: true } }, ...VALUATION_INCLUDE },
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
    return NextResponse.json({ data: serializeAsset(asset, schedule) });
  },
});

// DELETE /api/personal-assets/[id] … 実物資産の削除（editor 以上）
// ひも付いた借入（Loan）は消さない（借入そのものは残るため。借入金管理に残り、資産とのひも付けだけ外れる）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.personalAsset.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.personalAsset.delete({ where: { id } });
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ ok: true });
  },
});
