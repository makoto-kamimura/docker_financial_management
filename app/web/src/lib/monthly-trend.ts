import { forecast, type ForecastMethod } from "@/lib/forecast";
import { shiftMonthKey } from "@/lib/kpi";

// 対象月を中心とした前後の推移（構成比グラフ・予実対比グラフで共用）。
// 対象月以前は実績、対象月より後は予測で埋める。

export const TREND_CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "OTHER"] as const;
export type TrendCategory = (typeof TREND_CATEGORIES)[number];

export type CategoryAmounts = Partial<Record<TrendCategory, number>>;

export type TrendMonth = Record<TrendCategory, number> & {
  key: string; // "YYYY-MM"
  /** 対象月より後（予測で埋めた月）は true */
  isForecast: boolean;
  /** 貯蓄額の実績 = 収入 −（変動費 + 固定費）。予測月は null */
  savings: number | null;
  /** 貯蓄額の予測。実績月は null（対象月だけは線を繋ぐため実績値を入れる） */
  savingsForecast: number | null;
};

export type AccountTrendMonth = {
  key: string;
  budget: number;
  actual: number | null;
  forecast: number | null;
};

// 中心月から前 back か月・後 forward か月のキー列（昇順）
export function monthRange(center: string, back: number, forward: number): string[] {
  const keys: string[] = [];
  for (let i = -back; i <= forward; i++) keys.push(shiftMonthKey(center, i));
  return keys;
}

const savingsOf = (m: CategoryAmounts) => (m.REVENUE ?? 0) - ((m.COGS ?? 0) + (m.EXPENSE ?? 0));

// "YYYY-MM" を通し月数に変換する（差分を取るため）
export function monthIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}

// 任意の月リストについて推移を組み立てる。boundary（実績が確定している最後の月）より後は予測。
// 予測の学習には「boundary 以前の全実績」を使う（リストの外にある過去も含める）。
export function buildTrendMonths(
  actualByKey: Map<string, CategoryAmounts>,
  keys: string[],
  boundary: string,
  method: ForecastMethod,
): TrendMonth[] {
  const historyKeys = [...actualByKey.keys()].filter((k) => k <= boundary).sort();
  // boundary より後に必要な予測の長さ（リスト中で最も先の月まで）
  const maxForward = keys.reduce(
    (max, k) => Math.max(max, monthIndex(k) - monthIndex(boundary)),
    0,
  );

  const forecastByCat = new Map<TrendCategory, number[]>();
  for (const cat of TREND_CATEGORIES) {
    const history = historyKeys.map((k) => actualByKey.get(k)?.[cat] ?? 0);
    // 実績が 1 件も無ければ予測もしない（0 の羅列を予測として見せない）
    forecastByCat.set(cat, history.length === 0 ? [] : forecast(history, maxForward, method));
  }

  return keys.map((key) => {
    const isForecast = key > boundary;
    // 予測列は boundary の次の月から順に対応する
    const fIndex = monthIndex(key) - monthIndex(boundary) - 1;
    const amounts: CategoryAmounts = isForecast
      ? Object.fromEntries(
          TREND_CATEGORIES.map((cat) => [cat, forecastByCat.get(cat)?.[fIndex] ?? 0]),
        )
      : (actualByKey.get(key) ?? {});

    const row = {
      key,
      isForecast,
      savings: isForecast ? null : actualByKey.has(key) ? savingsOf(amounts) : null,
      // 実績と予測の線を繋ぐため、境界の月には両方に同じ値を入れる
      savingsForecast: isForecast || key === boundary ? savingsOf(amounts) : null,
    } as TrendMonth;
    for (const cat of TREND_CATEGORIES) row[cat] = amounts[cat] ?? 0;
    return row;
  });
}

// 月×カテゴリの実績から、対象月を中心とした推移を組み立てる。
export function buildMonthlyTrend(
  actualByKey: Map<string, CategoryAmounts>,
  center: string,
  back: number,
  forward: number,
  method: ForecastMethod,
): TrendMonth[] {
  return buildTrendMonths(actualByKey, monthRange(center, back, forward), center, method);
}

// 指定年（1〜12月）の推移。boundary より後の月は予測で埋める。
export function buildYearTrend(
  actualByKey: Map<string, CategoryAmounts>,
  year: number,
  boundary: string,
  method: ForecastMethod,
): TrendMonth[] {
  const keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return buildTrendMonths(actualByKey, keys, boundary, method);
}

// 単一科目（予実対比グラフの対象科目）の推移。予算は実績有無に関わらず登録額を出す。
export function buildAccountTrend(
  budgetByKey: Map<string, number>,
  actualByKey: Map<string, number>,
  center: string,
  back: number,
  forward: number,
  method: ForecastMethod,
): AccountTrendMonth[] {
  const historyKeys = [...actualByKey.keys()].filter((k) => k <= center).sort();
  const history = historyKeys.map((k) => actualByKey.get(k) ?? 0);
  const forecasted = history.length === 0 ? [] : forecast(history, forward, method);

  return monthRange(center, back, forward).map((key, i) => {
    const isForecast = key > center;
    const fIndex = i - back - 1;
    const actual = isForecast ? null : (actualByKey.get(key) ?? null);
    return {
      key,
      budget: budgetByKey.get(key) ?? 0,
      actual,
      // 対象月は実績値を予測線にも入れて線を繋ぐ
      forecast: isForecast ? (forecasted[fIndex] ?? null) : key === center ? actual : null,
    };
  });
}
