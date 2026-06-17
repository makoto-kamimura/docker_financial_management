export type FinancialRecord = {
  accountCode: string;
  period: string; // "YYYY-MM"
  amount: number;
};

export type MonthlyAggregate = {
  period: string;
  total: number;
};

// 期間（月次）ごとに金額を合計する集計関数
export function aggregateMonthly(records: FinancialRecord[]): MonthlyAggregate[] {
  const byPeriod = new Map<string, number>();
  for (const r of records) {
    byPeriod.set(r.period, (byPeriod.get(r.period) ?? 0) + r.amount);
  }
  return [...byPeriod.entries()]
    .map(([period, total]) => ({ period, total }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
