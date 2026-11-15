import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import {
  BUDGET_CYCLE_CATEGORIES,
  ESTIMATE_MONTHS,
  estimateFromActuals,
  precedingMonths,
} from "@/lib/shared/budget-cycle";
import { actualWhere, SCOPE_SELECT, scopedAmount, ScopeQuery } from "@/lib/ledger/scope";
import { budgetScopeOf } from "@/lib/budget/budget-scope";

// GET /api/budgets/estimate?year=&month= … 実績から推測した予算案（読み取り専用）
//   予算の月の前の 3 か月の実績を科目ごとに並べ、平均を予算案として返す（lib/shared/budget-cycle.ts）。
//   前月の予算が未確定（サイクルの初回）で、前月の予実差から予算案を作れない月に、予算の確定タブが使う。
//   保存はしない。画面を開くたび・確定を押すたびに、その時点の実績で計算し直す。
//   その月に登録済みの予算（budget）も返す。平均が 0 でも予算が入っている科目は、行として残す。
//   scope=business は事業の分の実績と事業の予算。
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
    const months = precedingMonths(year, month, ESTIMATE_MONTHS);

    const [periods, period] = await Promise.all([
      db.period.findMany({
        where: { tenantId, OR: months.map((m) => ({ fiscalYear: m.year, month: m.month })) },
        select: { id: true, fiscalYear: true, month: true },
      }),
      db.period.findUnique({
        where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
        select: { id: true },
      }),
    ]);
    const indexByPeriod = new Map(
      periods.map((p) => [
        p.id,
        months.findIndex((m) => m.year === p.fiscalYear && m.month === p.month),
      ]),
    );

    const categoryFilter = { category: { in: [...BUDGET_CYCLE_CATEGORIES] } };
    const [records, budgets] = await Promise.all([
      periods.length === 0
        ? []
        : db.financialRecord.findMany({
            where: {
              tenantId,
              periodId: { in: periods.map((p) => p.id) },
              ...actualWhere(query.scope),
              account: categoryFilter,
            },
            select: { accountId: true, periodId: true, amount: true, ...SCOPE_SELECT },
          }),
      period
        ? db.budget.findMany({
            where: { tenantId, scope, periodId: period.id, account: categoryFilter },
            select: { accountId: true, amount: true },
          })
        : [],
    ]);

    const estimates = estimateFromActuals(
      records
        .filter((r) => r.accountId !== null && r.periodId !== null)
        .map((r) => ({
          accountId: r.accountId!,
          monthIndex: indexByPeriod.get(r.periodId!) ?? -1,
          amount: scopedAmount(r, query.scope),
        })),
      months.length,
    );
    const budgetMap = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
    const estimateMap = new Map(estimates.map((e) => [e.accountId, e]));
    const accountIds = [
      ...new Set([
        ...estimates.filter((e) => e.months.some((v) => v !== 0)).map((e) => e.accountId),
        ...budgetMap.keys(),
      ]),
    ];
    const accounts =
      accountIds.length === 0
        ? []
        : await db.account.findMany({
            where: { tenantId, id: { in: accountIds } },
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
              soleName: true,
              corporateName: true,
            },
            orderBy: { code: "asc" },
          });

    const rows = accounts.map((a) => {
      const e = estimateMap.get(a.id);
      return {
        accountId: a.id,
        accountCode: a.code,
        name: a.name,
        category: a.category,
        soleName: a.soleName,
        corporateName: a.corporateName,
        months: e?.months ?? months.map(() => 0),
        average: e?.average ?? 0,
        budget: budgetMap.get(a.id) ?? null,
      };
    });
    return NextResponse.json({ data: { year, month, months, rows } });
  },
});
