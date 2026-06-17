export type ForecastMethod = "moving_average" | "linear_regression" | "growth_rate";

// 単純な最小二乗法による線形回帰で将来値を予測する。
// history: 過去の実績値（時系列順）, months: 予測する先の月数
export function forecastLinear(history: number[], months: number): number[] {
  const n = history.length;
  if (n === 0) return [];

  // x = 0,1,2,... に対する y = history の回帰直線 y = a*x + b を求める
  const xs = history.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = history.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * history[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);

  const denom = n * sumXX - sumX * sumX;
  const a = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;

  const result: number[] = [];
  for (let i = 0; i < months; i++) {
    const x = n + i;
    result.push(Math.round(a * x + b));
  }
  return result;
}

// 移動平均による予測。直近 window 件の平均を将来値とし、逐次更新する。
export function forecastMovingAverage(history: number[], months: number, window = 3): number[] {
  if (history.length === 0) return [];
  const series = [...history];
  const result: number[] = [];
  for (let i = 0; i < months; i++) {
    const slice = series.slice(-Math.min(window, series.length));
    const avg = Math.round(slice.reduce((s, v) => s + v, 0) / slice.length);
    result.push(avg);
    series.push(avg);
  }
  return result;
}

// 成長率（直近の平均前月比）による予測。
export function forecastGrowthRate(history: number[], months: number): number[] {
  if (history.length < 2) {
    return forecastMovingAverage(history, months);
  }
  // 平均成長率を算出
  const rates: number[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1] !== 0) rates.push(history[i] / history[i - 1]);
  }
  const avgRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 1;

  const result: number[] = [];
  let prev = history.at(-1) ?? 0;
  for (let i = 0; i < months; i++) {
    prev = Math.round(prev * avgRate);
    result.push(prev);
  }
  return result;
}

// 手法を指定して予測する統一エントリポイント。
export function forecast(history: number[], months: number, method: ForecastMethod): number[] {
  switch (method) {
    case "moving_average":
      return forecastMovingAverage(history, months);
    case "growth_rate":
      return forecastGrowthRate(history, months);
    case "linear_regression":
    default:
      return forecastLinear(history, months);
  }
}
