// 変動金利の先行き予測。
//
// 借入金管理の返済スケジュールグラフに金利を重ねて表示するとき、既に登録済みの
// 金利変更履歴（適用日と改定幅）から「これまでと同じペースで改定が続いたら」という
// 前提で以降の金利を外挿する。あくまで傾向の延長であり、金融機関の通知ではない
// （グラフでも破線で「予測」として描き分ける）。

import type { RateChange } from "./debt-schedule";

/** 登録済みの金利変更 1 件（ymIndex 基準の適用月、改定後・改定前の年利%） */
export type RateHistoryEntry = {
  effectiveYm: number;
  rate: number;
  previousRate: number;
};

/** 予測が成り立つ最低件数。変更 1 回では改定の間隔が読めないため 2 件必要 */
export const MIN_HISTORY_FOR_FORECAST = 2;

/** 予測を打ち切る上限件数（返済期間が長いローンで無限に増やさないための保険） */
const MAX_FORECAST_POINTS = 60;

/** 予測金利の下限・上限（%）。マイナス金利や非現実的な暴騰まで外挿しない */
const MIN_RATE = 0;
const MAX_RATE = 20;

export type RateForecast = {
  /** 予測した金利変更（rateResolver にそのまま渡せる形） */
  changes: RateChange[];
  /** 改定の平均間隔（月）。予測できなかった場合は null */
  intervalMonths: number | null;
  /** 1 回あたりの平均改定幅（%ポイント）。予測できなかった場合は null */
  deltaPerChange: number | null;
};

const EMPTY: RateForecast = { changes: [], intervalMonths: null, deltaPerChange: null };

/**
 * 金利変更履歴の傾向から、untilYm までの金利変更を予測する。
 *
 * - 改定の平均間隔（直近の変更同士の月数の平均）ごとに、
 * - 1 回あたりの平均改定幅（rate − previousRate の平均）だけ動く
 *
 * という単純な線形の外挿。履歴が {@link MIN_HISTORY_FOR_FORECAST} 件未満、
 * または改定幅の平均が 0（上げ下げが相殺）の場合は予測しない。
 */
export function forecastRateChanges(
  history: RateHistoryEntry[],
  opts: { untilYm: number },
): RateForecast {
  if (history.length < MIN_HISTORY_FOR_FORECAST) return EMPTY;

  const sorted = [...history].sort((a, b) => a.effectiveYm - b.effectiveYm);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].effectiveYm - sorted[i - 1].effectiveYm);
  }
  const intervalMonths = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));

  const deltas = sorted.map((c) => c.rate - c.previousRate);
  const deltaPerChange = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  // 上げ下げが相殺して傾向が無い場合は、横ばいとみなして予測線を出さない
  if (Math.abs(deltaPerChange) < 1e-9) {
    return { changes: [], intervalMonths, deltaPerChange };
  }

  const last = sorted[sorted.length - 1];
  const changes: RateChange[] = [];
  for (let k = 1; k <= MAX_FORECAST_POINTS; k++) {
    const effectiveYm = last.effectiveYm + intervalMonths * k;
    if (effectiveYm > opts.untilYm) break;
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, last.rate + deltaPerChange * k));
    changes.push({ effectiveYm, rate });
    // 下限・上限に張り付いたらそれ以上は同じ値が続くだけなので打ち切る
    if (rate === MIN_RATE || rate === MAX_RATE) break;
  }

  return { changes, intervalMonths, deltaPerChange };
}
