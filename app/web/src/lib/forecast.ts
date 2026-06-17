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
