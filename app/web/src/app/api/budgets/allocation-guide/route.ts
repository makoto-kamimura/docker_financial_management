import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { suggestAllocation } from "@/lib/budget/allocation";
import { splitByRatio } from "@/lib/shared/allocation-assign";
import { loadActualWeights, loadAllocationContext } from "@/lib/budget/allocation-data";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget/budget-overlay";

// GET /api/budgets/allocation-guide?year=YYYY
//   … 予算管理のマトリクスに重ねる「適正金額」。収入（REVENUE）の実績が入力済みの月について、
//     予算配分ルール（予算管理 › 設定タブ）の割合で各ルールの推奨額を出し、
//     ルールのメンバー科目（自動の振り分け＋手動の割り当て）へ、前の 3 か月の実績の比率で按分する
//     （実績が無ければ均等）。予算の有無に関係なく出す参考値で、予算の値は変えない。
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

    const [context, loanOverlay, debtOverlay] = await Promise.all([
      loadAllocationContext(db, tenantId),
      computeLoanOverlay(db, tenantId, year),
      computePersonalAssetDebtOverlay(db, tenantId, year),
    ]);
    const { ruleInputs, members, accounts } = context;
    const codeById = new Map(accounts.map((a) => [a.id, a.code]));
    const weightsFor = await loadActualWeights(
      db,
      tenantId,
      accounts.map((a) => a.id),
      { year, month: 1 },
      { year, month: 12 },
    );

    const overlaysAll = [...loanOverlay, ...debtOverlay];
    const rows: { accountId: number; accountCode: string; month: number; amount: number }[] = [];

    for (const [month, basisAmount] of basisByMonth) {
      if (basisAmount <= 0) continue;
      const overlays = overlaysAll
        .filter((o) => o.month === month)
        .map((o) => ({ accountId: o.accountId, amount: o.amount }));
      const { items } = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });
      const weights = weightsFor(year, month);
      for (const item of items) {
        // メンバー科目が無いルールは予算表に重ねられないので飛ばす
        const ids = members.get(item.rule.id) ?? [];
        if (ids.length === 0 || item.recommended <= 0) continue;
        for (const [accountId, amount] of splitByRatio(item.recommended, ids, weights)) {
          if (amount <= 0) continue;
          rows.push({ accountId, accountCode: codeById.get(accountId)!, month, amount });
        }
      }
    }

    return NextResponse.json({ year, data: rows });
  },
});
