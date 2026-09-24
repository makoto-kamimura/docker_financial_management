import { describe, expect, it } from "vitest";
import { forecastRateChanges } from "./rate-forecast";
import { rateResolver } from "./debt-schedule";

// ym は ymIndex() 基準（年 * 12 + 月インデックス）。読みやすさのため補助関数で作る
const ym = (year: number, month1to12: number) => year * 12 + (month1to12 - 1);

describe("forecastRateChanges", () => {
  it("履歴が 1 件以下なら予測しない（改定の間隔が読めない）", () => {
    expect(forecastRateChanges([], { untilYm: ym(2030, 1) }).changes).toEqual([]);
    const one = [{ effectiveYm: ym(2026, 1), rate: 1.06, previousRate: 0.81 }];
    expect(forecastRateChanges(one, { untilYm: ym(2030, 1) }).changes).toEqual([]);
  });

  it("平均間隔・平均改定幅で以降の金利を外挿する", () => {
    const history = [
      { effectiveYm: ym(2024, 1), rate: 0.81, previousRate: 0.61 },
      { effectiveYm: ym(2025, 1), rate: 1.06, previousRate: 0.81 },
    ];
    const f = forecastRateChanges(history, { untilYm: ym(2027, 1) });
    expect(f.intervalMonths).toBe(12);
    expect(f.deltaPerChange).toBeCloseTo(0.225, 6);
    expect(f.changes).toHaveLength(2);
    expect(f.changes[0].effectiveYm).toBe(ym(2026, 1));
    expect(f.changes[0].rate).toBeCloseTo(1.285, 6);
    expect(f.changes[1].effectiveYm).toBe(ym(2027, 1));
    expect(f.changes[1].rate).toBeCloseTo(1.51, 6);
  });

  it("untilYm より先は返さない", () => {
    const history = [
      { effectiveYm: ym(2024, 1), rate: 0.81, previousRate: 0.61 },
      { effectiveYm: ym(2025, 1), rate: 1.06, previousRate: 0.81 },
    ];
    expect(forecastRateChanges(history, { untilYm: ym(2025, 6) }).changes).toEqual([]);
  });

  it("上げ下げが相殺して傾向が無ければ予測しない", () => {
    const history = [
      { effectiveYm: ym(2024, 1), rate: 1.2, previousRate: 1.0 },
      { effectiveYm: ym(2025, 1), rate: 1.0, previousRate: 1.2 },
    ];
    const f = forecastRateChanges(history, { untilYm: ym(2030, 1) });
    expect(f.changes).toEqual([]);
    expect(f.intervalMonths).toBe(12);
  });

  it("下降トレンドは 0% を下限に打ち切る", () => {
    const history = [
      { effectiveYm: ym(2024, 1), rate: 0.6, previousRate: 1.0 },
      { effectiveYm: ym(2025, 1), rate: 0.2, previousRate: 0.6 },
    ];
    const f = forecastRateChanges(history, { untilYm: ym(2035, 1) });
    expect(f.changes.map((c) => c.rate)).toEqual([0]);
  });

  it("rateResolver にそのまま渡して月ごとの金利を引ける", () => {
    const history = [
      { effectiveYm: ym(2024, 1), rate: 0.81, previousRate: 0.61 },
      { effectiveYm: ym(2025, 1), rate: 1.06, previousRate: 0.81 },
    ];
    const { changes } = forecastRateChanges(history, { untilYm: ym(2027, 1) });
    const rateAt = rateResolver(1.06, changes);
    expect(rateAt(ym(2025, 12))).toBeCloseTo(1.06, 6);
    expect(rateAt(ym(2026, 1))).toBeCloseTo(1.285, 6);
    expect(rateAt(ym(2027, 6))).toBeCloseTo(1.51, 6);
  });
});
