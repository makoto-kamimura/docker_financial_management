import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

// GET /api/reports/composition?year= … 年間カテゴリ構成比（円グラフ + 月別積み上げ）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year ?? new Date().getFullYear();

    const records = await db.financialRecord.findMany({
      where: { tenantId, period: { fiscalYear: year } },
      include: {
        account: { select: { category: true, name: true, code: true } },
        period: { select: { month: true } },
      },
    });

    const byMonthCategory = new Map<string, number>();
    const byCategory = new Map<string, number>();

    for (const r of records) {
      const cat = r.account.category;
      const month = r.period.month;
      const amount = Math.abs(Number(r.amount));

      if (cat === "ASSET" || cat === "LIABILITY") continue;

      const monthKey = `${month}:${cat}`;
      byMonthCategory.set(monthKey, (byMonthCategory.get(monthKey) ?? 0) + amount);
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + amount);
    }

    const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "OTHER"];

    const monthly = MONTHS.map((m) => {
      const row: Record<string, number | string> = { month: `${m}月` };
      for (const cat of CATEGORIES) {
        row[cat] = byMonthCategory.get(`${m}:${cat}`) ?? 0;
      }
      return row;
    });

    const totals = CATEGORIES.map((cat) => ({
      name: cat,
      value: byCategory.get(cat) ?? 0,
    })).filter((d) => d.value > 0);

    const years = await db.period.findMany({
      where: { tenantId },
      select: { fiscalYear: true },
      distinct: ["fiscalYear"],
      orderBy: { fiscalYear: "asc" },
    });

    return NextResponse.json({
      year,
      monthly,
      totals,
      years: years.map((y) => y.fiscalYear),
    });
  },
});
