import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { loadAllocationContext } from "@/lib/budget/allocation-data";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget/budget-overlay";
import {
  BUDGET_CYCLE_CATEGORIES,
  computeVariance,
  summarizeVariance,
  type BudgetCycleCategory,
} from "@/lib/shared/budget-cycle";
import { loadCycleStatus } from "@/lib/budget/cycle-status";
import { actualWhere, SCOPE_SELECT, scopedAmount, ScopeQuery } from "@/lib/ledger/scope";
import { budgetScopeOf } from "@/lib/budget/budget-scope";
import { SAVINGS_RULE_KEY } from "@/lib/budget/default-allocation-rules";

// GET /api/budgets/variance?year=&month= … 予実対比（科目別）と翌月の予算・確定状況（読み取り専用）
//   当月の予算（自動反映を含む）と実績の差、翌月に登録済みの予算、両月の確定状況、
//   余りの回し先の既定（予算配分ルール「貯蓄・投資」に入る科目のうちコードが一番小さいもの）を返す。
//   確定状況（① 当月の予算・② 当月の実績・③ 翌月の予算と、前月の実績）は lib/budget/cycle-status.ts で出す。
//   翌月の予算案そのものは、差額の扱いを画面で選びながら lib/shared/budget-cycle.ts で作る。
//   scope=business（個人事業主モード）は、事業の予算と事業の分の実績を比べる。予算の確定状況も事業のもの、
//   借入・実物資産の上乗せは事業利用のものだけ。余りの回し先の既定は「事業主の取り分」ルールから選ぶ。
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month } = query;
    const scope = budgetScopeOf(query.scope);
    const { periodId, nextPeriodId, status } = await loadCycleStatus(
      db,
      tenantId,
      year,
      month,
      scope,
    );

    const categoryFilter = { category: { in: [...BUDGET_CYCLE_CATEGORIES] } };
    const [accounts, budgets, nextBudgets, actuals, loanOverlay, debtOverlay, savingsRule] =
      await Promise.all([
        db.account.findMany({
          where: { tenantId, ...categoryFilter },
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            soleName: true,
            corporateName: true,
          },
          orderBy: { code: "asc" },
        }),
        periodId
          ? db.budget.findMany({
              where: { tenantId, scope, periodId },
              select: { accountId: true, amount: true },
            })
          : [],
        nextPeriodId
          ? db.budget.findMany({
              where: { tenantId, scope, periodId: nextPeriodId },
              select: { accountId: true, amount: true },
            })
          : [],
        periodId
          ? db.financialRecord.findMany({
              where: { tenantId, periodId, ...actualWhere(query.scope) },
              select: { accountId: true, amount: true, ...SCOPE_SELECT },
            })
          : [],
        computeLoanOverlay(db, tenantId, year, scope),
        computePersonalAssetDebtOverlay(db, tenantId, year, scope),
        // 余りの回し先の既定: 「貯蓄・投資」（事業は「事業主の取り分」）ルールのメンバー科目のうちコードが一番小さいもの
        db.allocationRule.findUnique({
          where: { tenantId_scope_key: { tenantId, scope, key: SAVINGS_RULE_KEY[scope] } },
          select: { id: true },
        }),
      ]);

    let savingsTargetId: number | null = null;
    if (savingsRule) {
      const { members, accounts: targets } = await loadAllocationContext(db, tenantId, scope);
      const ids = new Set(members.get(savingsRule.id) ?? []);
      savingsTargetId = targets.find((a) => ids.has(a.id))?.id ?? null;
    }

    const budgetMap = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
    const nextBudgetMap = new Map(nextBudgets.map((b) => [b.accountId, Number(b.amount)]));
    const actualMap = new Map<number, number>();
    for (const a of actuals) {
      if (a.accountId === null) continue;
      actualMap.set(a.accountId, (actualMap.get(a.accountId) ?? 0) + scopedAmount(a, query.scope));
    }
    const overlayMap = new Map<number, number>();
    for (const o of [...loanOverlay, ...debtOverlay]) {
      if (o.month !== month) continue;
      overlayMap.set(o.accountId, (overlayMap.get(o.accountId) ?? 0) + o.amount);
    }

    const rows = accounts
      .filter(
        (a) =>
          budgetMap.has(a.id) ||
          nextBudgetMap.has(a.id) ||
          overlayMap.has(a.id) ||
          (actualMap.get(a.id) ?? 0) !== 0,
      )
      .map((a) => ({
        ...computeVariance({
          accountId: a.id,
          accountCode: a.code,
          name: a.name,
          category: a.category as BudgetCycleCategory,
          budget: budgetMap.get(a.id) ?? null,
          overlay: overlayMap.get(a.id) ?? 0,
          actual: actualMap.get(a.id) ?? 0,
          nextBudget: nextBudgetMap.get(a.id) ?? null,
        }),
        soleName: a.soleName,
        corporateName: a.corporateName,
      }));

    return NextResponse.json({
      data: {
        ...status,
        transferTargetId: savingsTargetId,
        rows,
        summary: summarizeVariance(rows),
      },
    });
  },
});
