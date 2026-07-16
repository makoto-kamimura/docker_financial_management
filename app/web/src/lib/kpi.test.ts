import { describe, expect, it } from "vitest";
import { categoryBucket, computeLatestKpi, type MonthlyByCategory } from "@/lib/kpi";

describe("categoryBucket", () => {
  it("カテゴリを集計バケットへマップする", () => {
    expect(categoryBucket("REVENUE")).toBe("revenue");
    expect(categoryBucket("COGS")).toBe("cogs");
    expect(categoryBucket("EXPENSE")).toBe("expense");
    expect(categoryBucket("PROFIT")).toBeNull();
    expect(categoryBucket("OTHER")).toBeNull();
  });
});

describe("computeLatestKpi", () => {
  const monthly: MonthlyByCategory[] = [
    { key: "2025-01", revenue: 1000, cogs: 400, expense: 200 },
    { key: "2025-02", revenue: 1200, cogs: 480, expense: 240 },
  ];

  it("最新月の利益・利益率を算出する", () => {
    const kpi = computeLatestKpi(monthly)!;
    expect(kpi.period).toBe("2025-02");
    expect(kpi.grossProfit).toBe(720); // 1200-480
    expect(kpi.grossMargin).toBeCloseTo(0.6);
    expect(kpi.operatingProfit).toBe(480); // 720-240
    expect(kpi.operatingMargin).toBeCloseTo(0.4);
  });

  it("前月比(MoM)と当年累計(YTD)を算出する", () => {
    const kpi = computeLatestKpi(monthly)!;
    expect(kpi.mom).toBeCloseTo(0.2); // (1200-1000)/1000
    expect(kpi.ytd).toBe(2200); // 1000+1200
  });

  it("前年同月が無ければ YoY は null", () => {
    expect(computeLatestKpi(monthly)!.yoy).toBeNull();
  });

  it("前年同月があれば YoY を算出する", () => {
    const withPrevYear: MonthlyByCategory[] = [
      { key: "2024-02", revenue: 800, cogs: 0, expense: 0 },
      ...monthly,
    ];
    expect(computeLatestKpi(withPrevYear)!.yoy).toBeCloseTo(0.5); // (1200-800)/800
  });

  it("空配列なら null", () => {
    expect(computeLatestKpi([])).toBeNull();
  });

  it("[F-1] 支出が収入を上回る月は operatingProfit が負になる（赤字警告の判定基準）", () => {
    const deficitMonthly: MonthlyByCategory[] = [
      { key: "2026-05", revenue: 1000, cogs: 200, expense: 300 },
      { key: "2026-06", revenue: 1000, cogs: 200, expense: 2000 },
    ];
    const kpi = computeLatestKpi(deficitMonthly)!;
    expect(kpi.operatingProfit).toBeLessThan(0);
    expect(kpi.operatingProfit).toBe(-1200); // (1000-200) - 2000
  });
});
