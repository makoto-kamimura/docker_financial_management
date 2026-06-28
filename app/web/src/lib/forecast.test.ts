import { describe, expect, it } from "vitest";
import {
  forecast,
  forecastGrowthRate,
  forecastHolt,
  forecastHoltWinters,
  forecastLinear,
  forecastMovingAverage,
} from "@/lib/forecast";

describe("forecastLinear", () => {
  it("完全な直線は外挿できる", () => {
    // y = x+1 の系列 [1,2,3,4] → 次は 5,6
    expect(forecastLinear([1, 2, 3, 4], 2)).toEqual([5, 6]);
  });
  it("空配列なら空", () => {
    expect(forecastLinear([], 3)).toEqual([]);
  });
  it("指定した月数だけ返す", () => {
    expect(forecastLinear([10, 20, 30], 4)).toHaveLength(4);
  });
});

describe("forecastMovingAverage", () => {
  it("一定値はその値を維持する", () => {
    expect(forecastMovingAverage([3, 3, 3], 2)).toEqual([3, 3]);
  });
  it("直近 window の平均を用いる", () => {
    // 直近3件 [2,4,6] の平均=4
    expect(forecastMovingAverage([2, 4, 6], 1)).toEqual([4]);
  });
});

describe("forecastGrowthRate", () => {
  it("一定成長率を反映する", () => {
    // 平均成長率 1.1 → 121*1.1=133.1→133, 133*1.1=146.3→146
    expect(forecastGrowthRate([100, 110, 121], 2)).toEqual([133, 146]);
  });
  it("データ不足時は移動平均にフォールバック", () => {
    expect(forecastGrowthRate([100], 2)).toEqual([100, 100]);
  });
});

describe("forecastHolt", () => {
  it("指定月数を返し、上昇トレンドを外挿する", () => {
    const result = forecastHolt([10, 20, 30, 40], 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(40);
  });
});

describe("forecastHoltWinters", () => {
  it("2季節周期未満は Holt にフォールバックする", () => {
    const history = [10, 20, 30];
    expect(forecastHoltWinters(history, 2, 12)).toEqual(forecastHolt(history, 2));
  });
  it("十分な季節データがあれば指定月数を返す", () => {
    // seasonLength=4, 3周期分(12点)
    const history = [10, 20, 30, 40, 12, 22, 32, 42, 14, 24, 34, 44];
    expect(forecastHoltWinters(history, 4, 4)).toHaveLength(4);
  });
});

describe("forecast (dispatch)", () => {
  const history = [10, 20, 30];
  it("methodごとに対応関数へ委譲する", () => {
    expect(forecast(history, 2, "linear_regression")).toEqual(forecastLinear(history, 2));
    expect(forecast(history, 2, "moving_average")).toEqual(forecastMovingAverage(history, 2));
    expect(forecast(history, 2, "growth_rate")).toEqual(forecastGrowthRate(history, 2));
    expect(forecast(history, 2, "holt")).toEqual(forecastHolt(history, 2));
  });
});
