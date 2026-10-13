import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { splitRuleTarget, suggestAllocation } from "@/lib/budget/allocation";
import { loadActualWeights, loadAllocationContext } from "@/lib/budget/allocation-data";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget/budget-overlay";
import { actualWhere, SCOPE_SELECT, scopedAmount, ScopeQuery } from "@/lib/ledger/scope";
import { budgetScopeOf } from "@/lib/budget/budget-scope";

// GET /api/budgets/allocation-guide?year=YYYY
//   … 予算管理のマトリクスに重ねる「適正金額」。収入（REVENUE）の実績が入力済みの月について、
//     予算配分ルール（予算管理 › 設定タブ）の割合で各ルールの推奨額を出し、
//     ルールのメンバー科目（自動の振り分け＋手動の割り当て）へ、前の 3 か月の実績の比率で按分する
//     （実績が無ければ均等）。ローン返済などの自動反映がある科目は、その額で埋まっているものとして、
//     目標額の残りを他の科目へ按分する（lib/budget/allocation.ts の splitRuleTarget）。予算の有無に関係なく出す参考値で、予算の値は変えない。
//     実績が無い月は算出しない（0 円の推奨を出さない）。
//     scope=business は事業の予算（事業の配分ルール・事業の分の実績・事業利用の借入の上乗せ）。
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({ year: z.coerce.number().int() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year } = query;
    const scope = budgetScopeOf(query.scope);

    // 月ごとの収入実績（配分の基準額）
    const revenueRecords = await db.financialRecord.findMany({
      where: {
        tenantId,
        ...actualWhere(query.scope),
        period: { fiscalYear: year },
        account: { category: "REVENUE" },
      },
      select: { amount: true, ...SCOPE_SELECT, period: { select: { month: true } } },
    });
    const basisByMonth = new Map<number, number>();
    for (const r of revenueRecords) {
      const m = r.period.month;
      basisByMonth.set(m, (basisByMonth.get(m) ?? 0) + scopedAmount(r, query.scope));
    }

    const [context, loanOverlay, debtOverlay] = await Promise.all([
      loadAllocationContext(db, tenantId, scope),
      computeLoanOverlay(db, tenantId, year, scope),
      computePersonalAssetDebtOverlay(db, tenantId, year, scope),
    ]);
    const { ruleInputs, members, accounts, assignments } = context;
    const ruleIdByAccount = new Map(assignments.map((a) => [a.accountId, a.ruleId]));
    const codeById = new Map(accounts.map((a) => [a.id, a.code]));
    const weightsFor = await loadActualWeights(
      db,
      tenantId,
      accounts.map((a) => a.id),
      { year, month: 1 },
      { year, month: 12 },
      scope,
    );

    const overlaysAll = [...loanOverlay, ...debtOverlay];
    const rows: { accountId: number; accountCode: string; month: number; amount: number }[] = [];

    for (const [month, basisAmount] of basisByMonth) {
      if (basisAmount <= 0) continue;
      const overlays = overlaysAll
        .filter((o) => o.month === month)
        .map((o) => ({
          accountId: o.accountId,
          amount: o.amount,
          ruleId: ruleIdByAccount.get(o.accountId) ?? null,
        }));
      const overlayByAccount = new Map<number, number>();
      for (const o of overlays) {
        overlayByAccount.set(o.accountId, (overlayByAccount.get(o.accountId) ?? 0) + o.amount);
      }
      const { items } = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });
      const weights = weightsFor(year, month);
      for (const item of items) {
        // メンバー科目が無いルールは予算表に重ねられないので飛ばす
        const ids = members.get(item.rule.id) ?? [];
        if (ids.length === 0 || item.recommended <= 0) continue;
        const split = splitRuleTarget({
          target: item.recommended,
          accountIds: ids,
          overlayByAccount,
          weights,
        });
        for (const [accountId, amount] of split) {
          if (amount <= 0) continue;
          rows.push({ accountId, accountCode: codeById.get(accountId)!, month, amount });
        }
      }
    }

    return NextResponse.json({ year, data: rows });
  },
});
