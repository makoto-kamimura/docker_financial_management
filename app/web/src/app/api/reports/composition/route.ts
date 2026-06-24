import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/reports/composition?year=YYYY
// カテゴリ別・月別の構成比データを返す
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  const records = await prisma.financialRecord.findMany({
    where: { period: { fiscalYear: year } },
    include: {
      account: { select: { category: true, name: true, code: true } },
      period: { select: { month: true } },
    },
  });

  // カテゴリ × 月 の集計
  const byMonthCategory = new Map<string, number>();
  const byCategory = new Map<string, number>();

  for (const r of records) {
    const cat = r.account.category;
    const month = r.period.month;
    const amount = Math.abs(Number(r.amount));

    // ASSET/LIABILITY は構成比の対象外
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

  // 利用可能な年一覧
  const years = await prisma.period.findMany({
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
}
