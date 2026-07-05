import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregate } from "@/lib/aggregate";
import { forecast, type ForecastMethod } from "@/lib/forecast";
import { buildBudgetActual } from "@/lib/report";
import { requireRole } from "@/lib/authz";

const keyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const sp = req.nextUrl.searchParams;
  const accountCode = sp.get("accountCode") ?? "4000";
  const year = Number(sp.get("year") ?? new Date().getFullYear());
  const method = (sp.get("method") ?? "linear_regression") as ForecastMethod;

  const account = await prisma.account.findUnique({
    where: { tenantId_code: { tenantId, code: accountCode } },
  });
  if (!account) {
    return NextResponse.json({ error: `unknown account code: ${accountCode}` }, { status: 400 });
  }

  const budgetRecords = await prisma.budget.findMany({
    where: { tenantId, accountId: account.id, period: { fiscalYear: year } },
    include: { period: true },
  });
  const budgets = budgetRecords.map((b) => ({
    period: keyOf(b.period.fiscalYear, b.period.month),
    amount: Number(b.amount),
  }));

  const actualRecords = await prisma.financialRecord.findMany({
    where: { tenantId, accountId: account.id, period: { fiscalYear: year } },
    include: { period: true },
  });
  const actuals = actualRecords.map((r) => ({
    period: keyOf(r.period.fiscalYear, r.period.month),
    amount: Number(r.amount),
  }));

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
