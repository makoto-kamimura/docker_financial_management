import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregate } from "@/lib/aggregate";
import { forecast, type ForecastMethod } from "@/lib/forecast";
import { buildBudgetActual } from "@/lib/report";
import { requireRole } from "@/lib/authz";

// 月キーを生成
const keyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// GET /api/reports/budget-actual?accountCode=4000&year=2025&method=linear_regression
// 予算 vs 実績 vs 予測の予実対比レポートを返す。
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const accountCode = sp.get("accountCode") ?? "4000";
  const year = Number(sp.get("year") ?? "2025");
  const method = (sp.get("method") ?? "linear_regression") as ForecastMethod;

  const account = await prisma.account.findUnique({ where: { code: accountCode } });
  if (!account) {
    return NextResponse.json({ error: `unknown account code: ${accountCode}` }, { status: 400 });
  }

  // 予算（対象年）
  const budgetRecords = await prisma.budget.findMany({
    where: { accountId: account.id, period: { fiscalYear: year } },
    include: { period: true },
  });
  const budgets = budgetRecords.map((b) => ({
    period: keyOf(b.period.fiscalYear, b.period.month),
    amount: Number(b.amount),
  }));

  // 実績（対象年）
  const actualRecords = await prisma.financialRecord.findMany({
    where: { accountId: account.id, period: { fiscalYear: year } },
    include: { period: true },
  });
  const actuals = actualRecords.map((r) => ({
    period: keyOf(r.period.fiscalYear, r.period.month),
    amount: Number(r.amount),
  }));

  // 予測（実績の続きとして残りの月を埋める）
  const monthlyActual = aggregate(
    actualRecords.map((r) => ({
      amount: Number(r.amount),
      fiscalYear: r.period.fiscalYear,
      quarter: r.period.quarter,
      month: r.period.month,
    })),
    "month",
  );
  const history = monthlyActual.map((b) => b.total);
  const remaining = Math.max(0, 12 - history.length);
  const predicted = forecast(history, remaining, method);
  const forecastMap = new Map<string, number>();
  predicted.forEach((v, i) => forecastMap.set(keyOf(year, history.length + i + 1), v));

  const report = buildBudgetActual(budgets, actuals, forecastMap);
  return NextResponse.json({ accountCode, year, method, ...report });
}
