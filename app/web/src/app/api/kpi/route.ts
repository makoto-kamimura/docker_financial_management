import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import {
  categoryBucket,
  computeAnnualOutlook,
  computeKpiAt,
  computeKpiBudgetAt,
  type MonthlyByCategory,
} from "@/lib/kpi";
import { forecast } from "@/lib/forecast";

// GET /api/kpi?period=YYYY-MM … 指定月（既定は現在月以前の最新月）の主要 KPI を返す。
// periods は実データのある月の昇順リストで、ダッシュボードの対象月セレクタが使う。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // 対象月を切り替えられるよう、未来月を含む全期間を取得する（既定値の決定は下の defaultKey で行う）
    const [records, budgets] = await Promise.all([
      db.financialRecord.findMany({
        where: { tenantId },
        include: { period: true, account: true },
      }),
      db.budget.findMany({
        where: { tenantId },
        include: { period: true, account: true },
      }),
    ]);

    // 実績・予算を同じ形（月 × カテゴリ）に畳む
    const fold = (rows: typeof records | typeof budgets) => {
      const byKey = new Map<string, MonthlyByCategory>();
      for (const r of rows) {
        const key = `${r.period.fiscalYear}-${String(r.period.month).padStart(2, "0")}`;
        const bucket = byKey.get(key) ?? { key, revenue: 0, cogs: 0, expense: 0 };
        const target = categoryBucket(r.account.category);
        if (target) bucket[target] += Number(r.amount);
        byKey.set(key, bucket);
      }
      return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    };

    const monthly = fold(records);
    const budgetMonthly = fold(budgets);
    const periods = monthly.map((m) => m.key);

    // 既定は「現在月以前で最も新しい月」。未来分の記録しか無ければ最新月へフォールバックする。
    const defaultKey =
      [...periods].reverse().find((k) => k <= currentKey) ?? periods[periods.length - 1];
    const targetKey = query.period && periods.includes(query.period) ? query.period : defaultKey;

    const kpi = computeKpiAt(monthly, targetKey);
    const budget = targetKey ? computeKpiBudgetAt(budgetMonthly, targetKey, kpi) : null;
    // 当年の着地見込み（残り月は移動平均で予測）と、その時点の達成率
    const annual = targetKey
      ? computeAnnualOutlook(monthly, targetKey, (history, months) =>
          forecast(history, months, "moving_average"),
        )
      : null;

    return NextResponse.json({ kpi, budget, periods, annual });
  },
});
