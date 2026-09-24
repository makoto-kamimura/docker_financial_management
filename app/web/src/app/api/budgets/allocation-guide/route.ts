import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { suggestAllocation, type AllocationRule } from "@/lib/allocation";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";

// GET /api/budgets/allocation-guide?year=YYYY
//   … 予算管理のマトリクスに重ねる「適正金額」。収入（REVENUE）の実績が入力済みの月について、
//     予算配分ルール（予算管理 › 予算配分タブ）の割合で各科目の推奨額を算出する。
//     実績が無い月は算出しない（0 円の推奨を出さない）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year } = query;

    // 月ごとの収入実績（配分の基準額）
    const revenueRecords = await db.financialRecord.findMany({
      where: { tenantId, period: { fiscalYear: year }, account: { category: "REVENUE" } },
      select: { amount: true, period: { select: { month: true } } },
    });
    const basisByMonth = new Map<number, number>();
    for (const r of revenueRecords) {
      const m = r.period.month;
      basisByMonth.set(m, (basisByMonth.get(m) ?? 0) + Number(r.amount));
    }

    const [rules, loanOverlay, debtOverlay] = await Promise.all([
      db.allocationRule.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { account: { select: { id: true, code: true } } },
      }),
      computeLoanOverlay(db, tenantId, year),
      computePersonalAssetDebtOverlay(db, tenantId, year),
    ]);

    const ruleInputs: AllocationRule[] = rules.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      group: r.group,
      minPercent: Number(r.minPercent),
      maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
      accountId: r.accountId,
      sortOrder: r.sortOrder,
    }));
    const codeByAccountId = new Map(
      rules.filter((r) => r.account).map((r) => [r.account!.id, r.account!.code]),
    );

    const overlaysAll = [...loanOverlay, ...debtOverlay];
    const rows: { accountId: number; accountCode: string; month: number; amount: number }[] = [];

    for (const [month, basisAmount] of basisByMonth) {
      if (basisAmount <= 0) continue;
      const overlays = overlaysAll
        .filter((o) => o.month === month)
        .map((o) => ({ accountId: o.accountId, amount: o.amount }));
      const { items } = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });
      for (const item of items) {
        const accountId = item.rule.accountId;
        const accountCode = accountId === null ? null : (codeByAccountId.get(accountId) ?? null);
        // 対応科目が未設定のルールは予算表に重ねられないので飛ばす
        if (accountId === null || accountCode === null || item.recommended <= 0) continue;
        rows.push({ accountId, accountCode, month, amount: item.recommended });
      }
    }

    return NextResponse.json({ year, data: rows });
  },
});
