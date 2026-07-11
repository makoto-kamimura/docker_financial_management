// 予実対比レポートの 1 行（月次）
export type BudgetActualRow = {
  period: string; // "YYYY-MM"
  budget: number; // 予算
  actual: number | null; // 実績（未到来は null）
  forecast: number | null; // 予測（実績が無い月）
  variance: number | null; // 差異 = 実績 - 予算
  achievementRate: number | null; // 達成率 = 実績 / 予算
};

export type BudgetActualReport = {
  rows: BudgetActualRow[];
  totals: {
    budget: number;
    actual: number;
    forecast: number;
    variance: number;
  };
};

// 予算・実績・予測を月次でマージして予実対比レポートを組み立てる。
// budgets / actuals は { period, amount } の配列、forecasts は period→値 のマップ。
export function buildBudgetActual(
  budgets: { period: string; amount: number }[],
  actuals: { period: string; amount: number }[],
  forecasts: Map<string, number>,
): BudgetActualReport {
  const actualMap = new Map(actuals.map((a) => [a.period, a.amount]));
  // 予算・実績のどちらか一方しか入力されていない月も行に含める
  const periods = [
    ...new Set([
      ...budgets.map((b) => b.period),
      ...actuals.map((a) => a.period),
      ...forecasts.keys(),
    ]),
  ].sort();
  const budgetMap = new Map(budgets.map((b) => [b.period, b.amount]));

  let tB = 0;
  let tA = 0;
  let tF = 0;

  const rows: BudgetActualRow[] = periods.map((period) => {
    const budget = budgetMap.get(period) ?? 0;
    const actual = actualMap.has(period) ? actualMap.get(period)! : null;
    const forecast = actual == null ? (forecasts.get(period) ?? null) : null;
    const variance = actual == null ? null : actual - budget;
    const achievementRate = actual == null || budget === 0 ? null : actual / budget;

    tB += budget;
    tA += actual ?? 0;
    tF += forecast ?? 0;

    return { period, budget, actual, forecast, variance, achievementRate };
  });

  return {
    rows,
    totals: { budget: tB, actual: tA, forecast: tF, variance: tA - tB },
  };
}
