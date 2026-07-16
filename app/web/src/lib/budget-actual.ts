import type { TenantDb } from "@/lib/tenant-db";
import { aggregate } from "@/lib/aggregate";
import { forecast, type ForecastMethod } from "@/lib/forecast";
import { buildBudgetActual } from "@/lib/report";
import { badRequest } from "@/lib/api-error";

const keyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// 予実対比レポートの生成（JSON 表示と CSV 出力で共用）。
// 科目の予算・実績を取得し、残月を指定手法で予測して予実対比を組み立てる。
export async function getBudgetActualReport(
  db: TenantDb,
  tenantId: number,
  accountCode: string,
  year: number,
  method: ForecastMethod,
) {
  const account = await db.account.findUnique({
    where: { tenantId_code: { tenantId, code: accountCode } },
  });
  if (!account) throw badRequest(`unknown account code: ${accountCode}`);

  const [budgetRecords, actualRecords] = await Promise.all([
    db.budget.findMany({
      where: { tenantId, accountId: account.id, period: { fiscalYear: year } },
      include: { period: true },
    }),
    db.financialRecord.findMany({
      where: { tenantId, accountId: account.id, period: { fiscalYear: year } },
      include: { period: true },
    }),
  ]);

  const budgets = budgetRecords.map((b) => ({
    period: keyOf(b.period.fiscalYear, b.period.month),
    amount: Number(b.amount),
  }));
  const actuals = actualRecords.map((r) => ({
    period: keyOf(r.period.fiscalYear, r.period.month),
    amount: Number(r.amount),
  }));

  const history = aggregate(
    actualRecords.map((r) => ({
      amount: Number(r.amount),
      fiscalYear: r.period.fiscalYear,
      quarter: r.period.quarter,
      month: r.period.month,
    })),
    "month",
  ).map((b) => b.total);

  const remaining = Math.max(0, 12 - history.length);
  const forecastMap = new Map<string, number>();
  forecast(history, remaining, method).forEach((v, i) =>
    forecastMap.set(keyOf(year, history.length + i + 1), v),
  );

  return buildBudgetActual(budgets, actuals, forecastMap);
}
