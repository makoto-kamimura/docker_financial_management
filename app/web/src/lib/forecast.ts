export type ForecastMethod =
  "moving_average" | "linear_regression" | "growth_rate" | "holt" | "holt_winters";

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

// Holt の線形指数平滑法（二重指数平滑法）。レベルとトレンドを平滑化する。
export function forecastHolt(history: number[], months: number, alpha = 0.5, beta = 0.3): number[] {
  if (history.length < 2) return forecastMovingAverage(history, months);

  let level = history[0];
  let trend = history[1] - history[0];
  for (let i = 1; i < history.length; i++) {
    const prevLevel = level;
    level = alpha * history[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const result: number[] = [];
  for (let h = 1; h <= months; h++) {
    result.push(Math.round(level + h * trend));
  }
  return result;
}

// Holt-Winters の加法的季節モデル（三重指数平滑法）。
// seasonLength: 季節周期（月次は通常 12）。データが 2 周期未満なら Holt にフォールバック。
export function forecastHoltWinters(
  history: number[],
  months: number,
  seasonLength = 12,
  alpha = 0.4,
  beta = 0.1,
  gamma = 0.3,
): number[] {
  const L = seasonLength;
  if (history.length < 2 * L) return forecastHolt(history, months);

  // 初期レベル・トレンド・季節指数を算出
  const seasons = Math.floor(history.length / L);
  const seasonAverages: number[] = [];
  for (let s = 0; s < seasons; s++) {
    const slice = history.slice(s * L, (s + 1) * L);
    seasonAverages.push(slice.reduce((a, b) => a + b, 0) / L);
  }

  let level = seasonAverages[0];
  let trend = (seasonAverages[1] - seasonAverages[0]) / L;
  const seasonal: number[] = [];
  for (let i = 0; i < L; i++) {
    let sum = 0;
    for (let s = 0; s < seasons; s++) sum += history[s * L + i] - seasonAverages[s];
    seasonal[i] = sum / seasons;
  }

  for (let i = 0; i < history.length; i++) {
    const prevLevel = level;
    const s = seasonal[i % L];
    level = alpha * (history[i] - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[i % L] = gamma * (history[i] - level) + (1 - gamma) * s;
  }

  const result: number[] = [];
  for (let h = 1; h <= months; h++) {
    const s = seasonal[(history.length + h - 1) % L];
    result.push(Math.round(level + h * trend + s));
  }
  return result;
}

export interface ForecastParams {
  window?: number; // moving_average: 移動平均ウィンドウ幅（デフォルト 3）
  alpha?: number; // holt / holt_winters: レベル平滑化係数（0〜1）
  beta?: number; // holt / holt_winters: トレンド平滑化係数（0〜1）
  gamma?: number; // holt_winters: 季節平滑化係数（0〜1）
  seasonLength?: number; // holt_winters: 季節周期（デフォルト 12）
}

// 手法を指定して予測する統一エントリポイント。
export function forecast(
  history: number[],
  months: number,
  method: ForecastMethod,
  params: ForecastParams = {},
): number[] {
  const { window = 3, alpha = 0.5, beta = 0.3, gamma = 0.3, seasonLength = 12 } = params;
  switch (method) {
    case "moving_average":
      return forecastMovingAverage(history, months, window);
    case "growth_rate":
      return forecastGrowthRate(history, months);
    case "holt":
      return forecastHolt(history, months, alpha, beta);
    case "holt_winters":
      return forecastHoltWinters(history, months, seasonLength, alpha, beta, gamma);
    case "linear_regression":
    default:
      return forecastLinear(history, months);
  }
}
