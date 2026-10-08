import { describe, expect, it } from "vitest";
import {
  categoryBucket,
  computeAnnualOutlook,
  computeKpiAt,
  computeKpiBudgetAt,
  computeLatestKpi,
  fiscalPeriodOf,
  shiftMonthKey,
  type MonthlyByCategory,
} from "@/lib/accounting/kpi";

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

  it("当年累計(YTD)を算出する", () => {
    expect(computeLatestKpi(monthly)!.ytd).toBe(2200); // 1000+1200
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

  it("決算月を指定すると、YTD は期首から対象月までの累計になる", () => {
    // 1 月決算 → 2 月始まり
    expect(computeKpiAt(monthly, "2026-03", 1)!.ytd).toBe(2700); // 2026-02〜03: 1200+1500
    expect(computeKpiAt(monthly, "2026-01", 1)!.ytd).toBe(1800); // 2025-02〜2026-01: 800+1000
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

describe("fiscalPeriodOf", () => {
  it("12 月決算は暦年（1〜12 月）", () => {
    expect(fiscalPeriodOf("2026-03")).toEqual({
      startKey: "2026-01",
      endKey: "2026-12",
      elapsedMonths: 3,
    });
  });

  it("3 月決算は 4 月始まり。1〜3 月は前の年の 4 月からの期", () => {
    expect(fiscalPeriodOf("2027-01", 3)).toEqual({
      startKey: "2026-04",
      endKey: "2027-03",
      elapsedMonths: 10,
    });
    expect(fiscalPeriodOf("2026-04", 3)).toEqual({
      startKey: "2026-04",
      endKey: "2027-03",
      elapsedMonths: 1,
    });
    expect(fiscalPeriodOf("2026-03", 3).elapsedMonths).toBe(12);
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
    expect(outlook.missingMonths).toBe(0);
    expect(outlook.remainingMonths).toBe(9);
    expect(outlook.forecastRemaining).toBe(900);
    expect(outlook.projected).toBe(1200);
    expect(outlook.progressRate).toBeCloseTo(0.25);
  });

  it("入力が対象月だけなら、その月 × 経過月数 ＋ 残りの予測（移動平均なら × 12）", () => {
    const only = [{ key: "2026-10", revenue: 300_000, cogs: 0, expense: 0 }];
    const outlook = computeAnnualOutlook(only, "2026-10", (h, n) =>
      Array.from({ length: n }, () => h[h.length - 1]),
    )!;
    expect(outlook.elapsedMonths).toBe(10);
    expect(outlook.enteredMonths).toBe(1);
    expect(outlook.missingMonths).toBe(9);
    expect(outlook.estimatedMissing).toBe(2_700_000);
    expect(outlook.projected).toBe(3_600_000);
  });

  it("途中の未入力の月は、入力のある月の平均で埋める", () => {
    const gaps: MonthlyByCategory[] = [
      { key: "2026-01", revenue: 100, cogs: 0, expense: 0 },
      { key: "2026-04", revenue: 300, cogs: 0, expense: 0 },
    ];
    const outlook = computeAnnualOutlook(gaps, "2026-04", flat(0))!;
    expect(outlook.missingMonths).toBe(2); // 2・3 月
    expect(outlook.estimatedMissing).toBe(400); // 平均 200 × 2
    expect(outlook.projected).toBe(800);
    expect(outlook.progressRate).toBeCloseTo(0.5);
  });

  it("12 月まで入力がそろえば、予測も按分もなく実績どおり（達成率 100%）", () => {
    const full = Array.from({ length: 12 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, "0")}`,
      revenue: 100,
      cogs: 0,
      expense: 0,
    }));
    const outlook = computeAnnualOutlook(full, "2026-12", flat(999))!;
    expect(outlook.remainingMonths).toBe(0);
    expect(outlook.missingMonths).toBe(0);
    expect(outlook.projected).toBe(1200);
    expect(outlook.progressRate).toBe(1);
  });

  it("前年の実績は当年累計に含めないが、残りの予測の学習には使う", () => {
    const withPrev = [{ key: "2025-12", revenue: 999, cogs: 0, expense: 0 }, ...monthly];
    let learned: number[] = [];
    const outlook = computeAnnualOutlook(withPrev, "2026-03", (h, n) => {
      learned = h;
      return Array.from({ length: n }, () => 0);
    })!;
    expect(outlook.ytd).toBe(300);
    expect(outlook.projected).toBe(300);
    expect(learned).toEqual([999, 100, 100, 100]);
  });

  it("value を指定すると利益（収入 − 原価 − 費用）の見込みを出す", () => {
    const pl: MonthlyByCategory[] = [{ key: "2026-06", revenue: 300, cogs: 50, expense: 150 }];
    const outlook = computeAnnualOutlook(pl, "2026-06", flat(100), {
      value: (m) => m.revenue - m.cogs - m.expense,
    })!;
    expect(outlook.ytd).toBe(100);
    expect(outlook.estimatedMissing).toBe(500); // 1〜5 月を 100 で埋める
    expect(outlook.projected).toBe(1200); // 100 + 500 + 100 × 6
  });

  it("3 月決算: 期首の 4 月だけ入力なら 4 月 × 12、前の期の月は累計に含めない", () => {
    const fy: MonthlyByCategory[] = [
      { key: "2026-03", revenue: 999, cogs: 0, expense: 0 },
      { key: "2026-04", revenue: 200, cogs: 0, expense: 0 },
    ];
    const outlook = computeAnnualOutlook(fy, "2026-04", flat(200), { closingMonth: 3 })!;
    expect(outlook).toMatchObject({
      closingMonth: 3,
      startKey: "2026-04",
      endKey: "2027-03",
      ytd: 200,
      elapsedMonths: 1,
      missingMonths: 0,
      remainingMonths: 11,
      projected: 2400,
    });
  });

  it("想定額が 0 なら達成率は null", () => {
    const zero: MonthlyByCategory[] = [{ key: "2026-01", revenue: 0, cogs: 0, expense: 0 }];
    expect(computeAnnualOutlook(zero, "2026-01", flat(0))!.progressRate).toBeNull();
  });

  describe("actualThroughKey（実績を確定した最後の月）", () => {
    // 3 月まで確定済みで、4・5 月は明細が途中までしか無い
    const partial: MonthlyByCategory[] = [
      ...monthly,
      { key: "2026-04", revenue: 5, cogs: 0, expense: 0 },
      { key: "2026-05", revenue: 1, cogs: 0, expense: 0 },
    ];

    it("対象月より前なら、その後の月は入力があっても累計にも学習にも入れず予測で埋める", () => {
      let learned: number[] = [];
      const outlook = computeAnnualOutlook(
        partial,
        "2026-05",
        (h, n) => {
          learned = h;
          return Array.from({ length: n }, () => 100);
        },
        { actualThroughKey: "2026-03" },
      )!;
      expect(outlook).toMatchObject({
        actualThroughKey: "2026-03",
        ytd: 300,
        elapsedMonths: 3,
        missingMonths: 0,
        remainingMonths: 9,
        projected: 1200,
      });
      expect(learned).toEqual([100, 100, 100]);
    });

    it("前の期で区切ると、期の 12 か月すべてを予測で埋める", () => {
      const withPrev = [{ key: "2025-12", revenue: 50, cogs: 0, expense: 0 }, ...partial];
      const outlook = computeAnnualOutlook(withPrev, "2026-05", flat(50), {
        actualThroughKey: "2025-12",
      })!;
      expect(outlook).toMatchObject({ ytd: 0, elapsedMonths: 0, remainingMonths: 12 });
      expect(outlook.projected).toBe(600);
    });

    it("対象月以降を渡すと、指定しないときと同じ（対象月まで実績）", () => {
      const base = computeAnnualOutlook(partial, "2026-05", flat(100))!;
      expect(base.actualThroughKey).toBe("2026-05");
      expect(
        computeAnnualOutlook(partial, "2026-05", flat(100), { actualThroughKey: "2026-08" }),
      ).toEqual(base);
    });
  });
});
