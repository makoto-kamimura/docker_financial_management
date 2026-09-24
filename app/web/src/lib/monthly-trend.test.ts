import { describe, expect, it } from "vitest";
import {
  buildAccountTrend,
  buildMonthlyTrend,
  buildYearTrend,
  monthRange,
  type CategoryAmounts,
} from "@/lib/monthly-trend";

describe("monthRange", () => {
  it("中心月の前後を昇順で返す", () => {
    expect(monthRange("2026-02", 2, 1)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
  });

  it("年をまたいで正しく並べる", () => {
    expect(monthRange("2026-01", 1, 1)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildMonthlyTrend", () => {
  const actual = new Map<string, CategoryAmounts>([
    ["2026-01", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
    ["2026-02", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
    ["2026-03", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
  ]);

  it("対象月を中心に前後の月を並べ、後ろは予測として印を付ける", () => {
    const months = buildMonthlyTrend(actual, "2026-03", 2, 2, "moving_average");
    expect(months.map((m) => m.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(months.map((m) => m.isForecast)).toEqual([false, false, false, true, true]);
  });

  it("実績月は savings を、予測月は savingsForecast を持つ", () => {
    const months = buildMonthlyTrend(actual, "2026-03", 2, 2, "moving_average");
    expect(months[0].savings).toBe(500); // 1000-(200+300)
    expect(months[0].savingsForecast).toBeNull();
    expect(months[3].savings).toBeNull();
    expect(months[3].savingsForecast).toBe(500); // 移動平均なので同額
  });

  it("対象月は実績・予測の両方を持ち、線が途切れない", () => {
    const months = buildMonthlyTrend(actual, "2026-03", 2, 2, "moving_average");
    const center = months.find((m) => m.key === "2026-03")!;
    expect(center.savings).toBe(500);
    expect(center.savingsForecast).toBe(500);
  });

  it("実績の無い過去月は 0 埋めし、savings は null（未入力を 0 円と区別する）", () => {
    const months = buildMonthlyTrend(actual, "2026-03", 4, 0, "moving_average");
    const missing = months.find((m) => m.key === "2025-11")!;
    expect(missing.REVENUE).toBe(0);
    expect(missing.savings).toBeNull();
  });

  it("対象月より後の実績は予測で上書きし、先読みしない", () => {
    // 2026-03 を対象月にすると 2026-04 の実績があっても予測値を使う
    const withFuture = new Map(actual);
    withFuture.set("2026-04", { REVENUE: 9999, COGS: 0, EXPENSE: 0 });
    const months = buildMonthlyTrend(withFuture, "2026-03", 1, 1, "moving_average");
    const april = months.find((m) => m.key === "2026-04")!;
    expect(april.REVENUE).toBe(1000);
  });

  it("実績が無ければ予測もしない", () => {
    const months = buildMonthlyTrend(new Map(), "2026-03", 1, 2, "moving_average");
    expect(months.every((m) => m.REVENUE === 0)).toBe(true);
    expect(months.every((m) => m.savings === null)).toBe(true);
  });
});

describe("buildYearTrend", () => {
  const actual = new Map<string, CategoryAmounts>([
    ["2026-01", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
    ["2026-02", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
    ["2026-03", { REVENUE: 1000, COGS: 200, EXPENSE: 300 }],
  ]);

  it("1〜12月を並べ、実績が確定した月より後は予測で埋める", () => {
    const months = buildYearTrend(actual, 2026, "2026-03", "moving_average");
    expect(months).toHaveLength(12);
    expect(months[0].key).toBe("2026-01");
    expect(months[11].key).toBe("2026-12");
    expect(months.filter((m) => m.isForecast).map((m) => m.key)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });

  it("未入力の将来月にも推測値が入る（0 のままにしない）", () => {
    const months = buildYearTrend(actual, 2026, "2026-03", "moving_average");
    const december = months.find((m) => m.key === "2026-12")!;
    expect(december.REVENUE).toBe(1000); // 直近3か月の移動平均
    expect(december.savings).toBeNull();
    expect(december.savingsForecast).toBe(500);
  });

  it("過去年度は全月が実績（予測で上書きしない）", () => {
    const past = new Map<string, CategoryAmounts>([["2025-05", { REVENUE: 800 }]]);
    const months = buildYearTrend(past, 2025, "2026-03", "moving_average");
    expect(months.every((m) => !m.isForecast)).toBe(true);
    expect(months.find((m) => m.key === "2025-05")!.REVENUE).toBe(800);
  });
});

describe("buildAccountTrend", () => {
  const budgets = new Map([
    ["2026-01", 100],
    ["2026-02", 100],
    ["2026-03", 100],
    ["2026-04", 120],
  ]);
  const actuals = new Map([
    ["2026-01", 90],
    ["2026-02", 110],
    ["2026-03", 100],
  ]);

  it("予算は実績が無い将来月も返す", () => {
    const months = buildAccountTrend(budgets, actuals, "2026-03", 2, 1, "moving_average");
    expect(months.map((m) => m.budget)).toEqual([100, 100, 100, 120]);
  });

  it("実績は対象月まで、予測は対象月より後", () => {
    const months = buildAccountTrend(budgets, actuals, "2026-03", 2, 1, "moving_average");
    expect(months.map((m) => m.actual)).toEqual([90, 110, 100, null]);
    expect(months[0].forecast).toBeNull();
    expect(months[2].forecast).toBe(100); // 対象月は実績値で線を繋ぐ
    expect(months[3].forecast).toBe(100); // 直近3か月平均 (90+110+100)/3
  });
});
