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
//   行に出す科目は、一度でも実績のある科目（期間を問わない）と、その月に予算が入っている科目。
//   前の 3 か月に実績が無い科目は平均 0 円。その月に登録済みの予算（budget）も返す。
//   表に無い科目は、画面の「科目を追加」で足す（初期値 0 円）。
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
    const [records, budgets, everRecorded] = await Promise.all([
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
      // 一度でも実績のある科目（前の 3 か月に実績が無くても行に出す）
      db.financialRecord.findMany({
        where: { tenantId, ...actualWhere(query.scope), account: categoryFilter },
        select: { accountId: true },
        distinct: ["accountId"],
      }),
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
        ...estimates.map((e) => e.accountId),
        ...everRecorded.flatMap((r) => (r.accountId === null ? [] : [r.accountId])),
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
