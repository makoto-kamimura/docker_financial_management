import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { loadAllocationContext } from "@/lib/allocation-data";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";
import {
  BUDGET_CYCLE_CATEGORIES,
  computeVariance,
  summarizeVariance,
  type BudgetCycleCategory,
} from "@/lib/budget-cycle";
import { loadCycleStatus } from "@/lib/cycle-status";
import { ACTUAL_WHERE } from "@/lib/actuals";

// GET /api/budgets/variance?year=&month= … 予実対比（科目別）と翌月の予算・確定状況（読み取り専用）
//   当月の予算（自動反映を含む）と実績の差、翌月に登録済みの予算、両月の確定状況、
//   余りの回し先の既定（予算配分ルール「貯蓄・投資」に入る科目のうちコードが一番小さいもの）を返す。
//   確定状況（① 当月の予算・② 当月の実績・③ 翌月の予算と、前月の実績）は lib/cycle-status.ts で出す。
//   翌月の予算案そのものは、差額の扱いを画面で選びながら lib/budget-cycle.ts で作る。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month } = query;
    const { periodId, nextPeriodId, status } = await loadCycleStatus(db, tenantId, year, month);

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
              where: { tenantId, periodId },
              select: { accountId: true, amount: true },
            })
          : [],
        nextPeriodId
          ? db.budget.findMany({
              where: { tenantId, periodId: nextPeriodId },
              select: { accountId: true, amount: true },
            })
          : [],
        periodId
          ? db.financialRecord.groupBy({
              by: ["accountId"],
              where: { tenantId, periodId, ...ACTUAL_WHERE },
              _sum: { amount: true },
            })
          : [],
        computeLoanOverlay(db, tenantId, year),
        computePersonalAssetDebtOverlay(db, tenantId, year),
        // 余りの回し先の既定: 「貯蓄・投資」ルールのメンバー科目のうちコードが一番小さいもの
        db.allocationRule.findUnique({
          where: { tenantId_key: { tenantId, key: "savings" } },
          select: { id: true },
        }),
      ]);

    let savingsTargetId: number | null = null;
    if (savingsRule) {
      const { members, accounts: targets } = await loadAllocationContext(db, tenantId);
      const ids = new Set(members.get(savingsRule.id) ?? []);
      savingsTargetId = targets.find((a) => ids.has(a.id))?.id ?? null;
    }

    const budgetMap = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
    const nextBudgetMap = new Map(nextBudgets.map((b) => [b.accountId, Number(b.amount)]));
    const actualMap = new Map(actuals.map((a) => [a.accountId, Number(a._sum.amount ?? 0)]));
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
