import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import { badRequest } from "@/lib/api-error";
import { zYearMonth } from "@/lib/zod-helpers";
import { computeDebtSchedule } from "@/lib/debt-schedule";
import {
  buildDebtLoanData,
  ratePercentOf,
  manualMonthlyPaymentOf,
} from "@/lib/personal-asset-debt";
import { invalidateCache } from "@/lib/redis";
import {
  PartInputSchema,
  recordValuation,
  ruleOfRow,
  serializeAsset,
  syncParts,
  VALUATION_INCLUDE,
  valuationData,
  valuationFields,
} from "@/lib/personal-asset-valuation";

const CreateSchema = z
  .object({
    name: z.string().min(1),
    category: z.enum(PERSONAL_ASSET_CATEGORIES).default("OTHER"),
    acquiredOn: z.string().optional(),
    acquisitionCost: z.number().optional(),
    // 内訳（parts）があるときは内訳の合計を使うので省略できる
    currentValue: z.number().optional(),
    // 純資産に評価額を計上するか。false = 負債のみ反映（ローンの諸費用等）
    countAsAsset: z.boolean().default(true),
    note: z.string().optional(),
    linkedAccountId: z.number().int().optional(),
    debtStartOn: zYearMonth.optional(), // 支払い開始年月（"YYYY-MM"）
    debtPayoffDue: zYearMonth.optional(), // 負債解消予定年月（"YYYY-MM"）
    debtInitialAmount: z.number().min(0).optional(), // 当初負債額
    // 年利（Loan.interestRate と同じ小数表記。0.0081 = 0.810%）
    debtInterestRate: z.number().min(0).max(1).optional(),
    // 残価設定ローンの据置額（最終回に一括支払い）。カーローン等
    debtResidualValue: z.number().min(0).optional(),
    // 価値の変わり方（内訳があるときは内訳ごとの設定を使う）
    ...valuationFields,
    // 内訳（住宅ローン 1 本で買った土地と建物など）。1 ローン 1 資産のまま、評価額と価値の変わり方を分ける
    parts: z
      .array(PartInputSchema.omit({ id: true }))
      .max(20)
      .optional(),
  })
  .refine((d) => !(d.debtStartOn && d.debtPayoffDue && d.debtStartOn > d.debtPayoffDue), {
    message: "debtStartOn must be before or equal to debtPayoffDue",
  })
  .refine((d) => (d.parts?.length ?? 0) > 0 || d.currentValue !== undefined, {
    message: "currentValue is required when parts are not given",
  });

// GET /api/personal-assets … 実物資産一覧（負債スケジュール・内訳・評価額の見積もり付き）
// D-4: 負債の実体は Loan（personal_assets.loanId）。レスポンスは旧フィールド名を維持する
// 評価額の見積もり（estimatedValue）と向き（trend）は lib/asset-valuation.ts で今日の時点を出す
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const assets = await db.personalAsset.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "asc" },
      include: { loan: true, ...VALUATION_INCLUDE },
    });
    const now = new Date();
    const data = assets.map((a) => {
      const schedule = a.loan
        ? computeDebtSchedule(
            Number(a.loan.amount),
            a.loan.borrowedOn,
            a.loan.repaymentDate,
            new Date(),
            ratePercentOf(Number(a.loan.interestRate)),
            manualMonthlyPaymentOf(a.loan),
            Number(a.loan.residualValue ?? 0),
          )
        : null;
      return serializeAsset(a, schedule, now);
    });
    return NextResponse.json({ data });
  },
});

// POST /api/personal-assets … 実物資産の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: CreateSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    if (body.linkedAccountId !== undefined) {
      const account = await db.account.findFirst({
        where: { id: body.linkedAccountId, tenantId },
      });
      if (!account) throw badRequest(`invalid linkedAccountId: ${body.linkedAccountId}`);
    }

    const debtData = buildDebtLoanData(body.name, {
      debtStartOn: body.debtStartOn ?? null,
      debtPayoffDue: body.debtPayoffDue ?? null,
      debtInitialAmount: body.debtInitialAmount ?? null,
      debtInterestRate: body.debtInterestRate ?? 0,
      debtResidualValue: body.debtResidualValue ?? 0,
    });

    const parts = body.parts ?? [];
    const asset = await db.$transaction(async (tx) => {
      const loan = debtData ? await tx.loan.create({ data: { tenantId, ...debtData } }) : null;
      const created = await tx.personalAsset.create({
        data: {
          tenantId,
          name: body.name,
          category: body.category,
          acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
          acquisitionCost: body.acquisitionCost ?? null,
          currentValue: body.currentValue ?? 0,
          countAsAsset: body.countAsAsset,
          note: body.note ?? null,
          linkedAccountId: body.linkedAccountId ?? null,
          loanId: loan?.id ?? null,
          ...valuationData(body),
        },
      });
      if (parts.length > 0) {
        // 内訳があれば、評価額と取得価格は内訳の合計
        const totals = await syncParts(tx, tenantId, created.id, parts, []);
        await tx.personalAsset.update({ where: { id: created.id }, data: totals });
      } else {
        await recordValuation(
          tx,
          tenantId,
          created.id,
          null,
          body.currentValue ?? 0,
          ruleOfRow(created),
        );
      }
      return tx.personalAsset.findUniqueOrThrow({
        where: { id: created.id },
        include: { loan: true, ...VALUATION_INCLUDE },
      });
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
    return NextResponse.json({ data: serializeAsset(asset, schedule) }, { status: 201 });
  },
});
