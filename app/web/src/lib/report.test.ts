import { describe, expect, it } from "vitest";
import { buildBudgetActual } from "@/lib/report";

describe("buildBudgetActual", () => {
  const budgets = [
    { period: "2025-01", amount: 1000 },
    { period: "2025-02", amount: 1000 },
    { period: "2025-03", amount: 1000 },
  ];
  const actuals = [
    { period: "2025-01", amount: 1100 },
    { period: "2025-02", amount: 900 },
  ];
  const forecasts = new Map<string, number>([["2025-03", 1050]]);

  const report = buildBudgetActual(budgets, actuals, forecasts);

  it("全期間の行を期間昇順で生成する", () => {
    expect(report.rows.map((r) => r.period)).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  it("実績がある月は差異・達成率を算出する", () => {
    const jan = report.rows[0];
    expect(jan.actual).toBe(1100);
    expect(jan.forecast).toBeNull();
    expect(jan.variance).toBe(100); // 1100-1000
    expect(jan.achievementRate).toBeCloseTo(1.1);
  });

  it("実績が無い月は予測で補い、差異・達成率は null", () => {
    const mar = report.rows[2];
    expect(mar.actual).toBeNull();
    expect(mar.forecast).toBe(1050);
    expect(mar.variance).toBeNull();
    expect(mar.achievementRate).toBeNull();
  });

  it("負の差異も符号付きで算出する", () => {
    expect(report.rows[1].variance).toBe(-100); // 900-1000
  });

  it("合計を集計する", () => {
    expect(report.totals).toEqual({
      budget: 3000,
      actual: 2000, // 1100+900+0
      forecast: 1050,
      variance: -1000, // 2000-3000
    });
  });
});
