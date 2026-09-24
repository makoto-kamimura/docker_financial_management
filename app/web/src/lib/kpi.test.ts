import { describe, expect, it } from "vitest";
import {
  categoryBucket,
  computeAnnualOutlook,
  computeKpiAt,
  computeKpiBudgetAt,
  computeLatestKpi,
  shiftMonthKey,
  type MonthlyByCategory,
} from "@/lib/kpi";

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

describe("shiftMonthKey", () => {
  it("月を前後にずらす（年跨ぎを含む）", () => {
    expect(shiftMonthKey("2026-07", -1)).toBe("2026-06");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-03", -12)).toBe("2025-03");
  });
});

describe("computeKpiAt", () => {
  const monthly: MonthlyByCategory[] = [
    { key: "2025-02", revenue: 800, cogs: 0, expense: 0 },
    { key: "2026-01", revenue: 1000, cogs: 400, expense: 200 },
    { key: "2026-02", revenue: 1200, cogs: 480, expense: 240 },
    { key: "2026-03", revenue: 1500, cogs: 600, expense: 300 },
  ];

  it("指定月の KPI を算出する", () => {
    const kpi = computeKpiAt(monthly, "2026-02")!;
    expect(kpi.period).toBe("2026-02");
    expect(kpi.revenue).toBe(1200);
    expect(kpi.grossProfit).toBe(720); // 1200-480
    expect(kpi.operatingProfit).toBe(480); // 720-240
  });

  it("YTD は対象月までの当年累計（対象月より後の月は含めない）", () => {
    expect(computeKpiAt(monthly, "2026-02")!.ytd).toBe(2200); // 1000+1200（1500 は含めない）
    expect(computeKpiAt(monthly, "2026-03")!.ytd).toBe(3700);
  });

  it("MoM / YoY は対象月を基準にした暦上の前月・前年同月と比較する", () => {
    const kpi = computeKpiAt(monthly, "2026-02")!;
    expect(kpi.mom).toBeCloseTo(0.2); // (1200-1000)/1000
    expect(kpi.yoy).toBeCloseTo(0.5); // (1200-800)/800
  });

  it("暦上の前月・前年同月のデータが無ければ null（欠測月を繰り上げない）", () => {
    const kpi = computeKpiAt(monthly, "2026-01")!;
    expect(kpi.mom).toBeNull(); // 2025-12 のデータが無い
    expect(kpi.yoy).toBeNull(); // 2025-01 のデータが無い
  });

  it("targetKey 省略時は最新月、系列に無い月の指定は null", () => {
    expect(computeKpiAt(monthly)!.period).toBe("2026-03");
    expect(computeKpiAt(monthly, "2026-09")).toBeNull();
  });
});

describe("computeKpiBudgetAt", () => {
  const actualMonthly: MonthlyByCategory[] = [
    { key: "2026-02", revenue: 1200, cogs: 480, expense: 240 },
  ];
  const budgetMonthly: MonthlyByCategory[] = [
    { key: "2026-02", revenue: 1000, cogs: 400, expense: 200 },
    { key: "2026-03", revenue: 0, cogs: 0, expense: 0 },
  ];

  it("対象月の予算と予算上の利益を返す", () => {
    const b = computeKpiBudgetAt(budgetMonthly, "2026-02", null)!;
    expect(b.revenue).toBe(1000);
    expect(b.grossProfit).toBe(600); // 1000-400
    expect(b.operatingProfit).toBe(400); // 600-200
  });

  it("実績を渡すと達成率（実績÷予算）を算出する", () => {
    const kpi = computeKpiAt(actualMonthly, "2026-02");
    const b = computeKpiBudgetAt(budgetMonthly, "2026-02", kpi)!;
    expect(b.revenueRate).toBeCloseTo(1.2); // 1200/1000
    expect(b.expenseRate).toBeCloseTo(1.2); // (480+240)/(400+200)
    expect(b.operatingProfitRate).toBeCloseTo(1.2); // 480/400
  });

  it("予算 0 の項目の達成率は null（0 除算を「—」に落とす）", () => {
    const kpi = computeKpiAt(actualMonthly, "2026-02");
    const b = computeKpiBudgetAt(budgetMonthly, "2026-03", kpi)!;
    expect(b.revenueRate).toBeNull();
    expect(b.operatingProfitRate).toBeNull();
  });

  it("対象月の予算が無ければ null（予算未設定と 0 円を区別する）", () => {
    expect(computeKpiBudgetAt(budgetMonthly, "2026-05", null)).toBeNull();
  });
});

describe("computeAnnualOutlook", () => {
  const monthly: MonthlyByCategory[] = [
    { key: "2026-01", revenue: 100, cogs: 0, expense: 0 },
    { key: "2026-02", revenue: 100, cogs: 0, expense: 0 },
    { key: "2026-03", revenue: 100, cogs: 0, expense: 0 },
  ];
  // 残り月を一定額で埋める単純な予測関数
  const flat = (value: number) => (_history: number[], months: number) =>
    Array.from({ length: months }, () => value);

  it("当年累計に残り月の予測を足して年間の想定額を出す", () => {
    const outlook = computeAnnualOutlook(monthly, "2026-03", flat(100))!;
    expect(outlook.ytd).toBe(300);
    expect(outlook.remainingMonths).toBe(9);
    expect(outlook.forecastRemaining).toBe(900);
    expect(outlook.projected).toBe(1200);
    expect(outlook.progressRate).toBeCloseTo(0.25);
  });

  it("12月は残り月が無く、想定額は実績どおり（達成率 100%）", () => {
    const dec = [...monthly, { key: "2026-12", revenue: 500, cogs: 0, expense: 0 }];
    const outlook = computeAnnualOutlook(dec, "2026-12", flat(100))!;
    expect(outlook.remainingMonths).toBe(0);
    expect(outlook.forecastRemaining).toBe(0);
    expect(outlook.projected).toBe(800);
    expect(outlook.progressRate).toBe(1);
  });

  it("前年の実績は当年累計に含めない", () => {
    const withPrev = [{ key: "2025-12", revenue: 999, cogs: 0, expense: 0 }, ...monthly];
    const outlook = computeAnnualOutlook(withPrev, "2026-03", flat(0))!;
    expect(outlook.ytd).toBe(300);
    expect(outlook.projected).toBe(300);
  });

  it("想定額が 0 なら達成率は null", () => {
    const zero: MonthlyByCategory[] = [{ key: "2026-01", revenue: 0, cogs: 0, expense: 0 }];
    expect(computeAnnualOutlook(zero, "2026-01", flat(0))!.progressRate).toBeNull();
  });
});
