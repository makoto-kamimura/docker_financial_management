import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { categoryBucket } from "@/lib/kpi";
import { buildCashFlow } from "@/lib/cashflow";

// GET /api/cashflow?year=2025
// 勘定科目カテゴリ別の合計から資金フロー図（Sankey）データを自動生成して返す。
// year 未指定なら全期間を集計する。
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : undefined;

  const records = await prisma.financialRecord.findMany({
    where: year ? { period: { fiscalYear: year } } : undefined,
    include: { account: true },
  });

  const totals = { revenue: 0, cogs: 0, expense: 0 };
  for (const r of records) {
    const bucket = categoryBucket(r.account.category);
    if (bucket) totals[bucket] += Number(r.amount);
  }

  const { graph, grossProfit, operatingProfit } = buildCashFlow(totals);

  return NextResponse.json({
    year: year ?? "all",
    totals: { ...totals, grossProfit, operatingProfit },
    graph,
  });
}
