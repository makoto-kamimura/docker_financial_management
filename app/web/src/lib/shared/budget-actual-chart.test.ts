import { describe, expect, it } from "vitest";
import { buildBudgetActualGroups } from "@/lib/shared/budget-actual-chart";
import { computeVariance, type BudgetCycleCategory } from "@/lib/shared/budget-cycle";

const row = (accountId: number, category: BudgetCycleCategory, budget: number, actual: number) =>
  computeVariance({
    accountId,
    accountCode: `A${accountId}`,
    name: `科目${accountId}`,
    category,
    budget,
    overlay: 0,
    actual,
    nextBudget: null,
  });

const labels = { revenue: "収入", expense: "支出" };
const nameOf = (r: { name: string }) => r.name;

describe("buildBudgetActualGroups", () => {
  it("収入と支出に分け、合計と科目別の棒を作る", () => {
    const groups = buildBudgetActualGroups(
      [row(1, "REVENUE", 300, 320), row(2, "EXPENSE", 100, 80), row(3, "EXPENSE", 50, 70)],
      nameOf,
      labels,
    );
    expect(groups.map((g) => g.kind)).toEqual(["revenue", "expense"]);
    const expense = groups[1];
    expect(expense.total).toMatchObject({ label: "支出", plan: 150, actual: 150, favorable: null });
    // 差の大きい順（同じ 20 なら予算の大きい順）
    expect(expense.items.map((b) => b.label)).toEqual(["科目2", "科目3"]);
    expect(expense.items[0]).toMatchObject({ difference: -20, favorable: true });
    expect(expense.items[1]).toMatchObject({ difference: 20, favorable: false });
    expect(groups[0].total.favorable).toBe(true); // 収入は多いほど有利
  });

  it("長さはグループ内の最大（予算・実績の大きいほう）に対する割合", () => {
    const [expense] = buildBudgetActualGroups(
      [row(1, "EXPENSE", 100, 200), row(2, "EXPENSE", 50, 0)],
      nameOf,
      labels,
    );
    expect(expense.items[0]).toMatchObject({ planRatio: 0.5, actualRatio: 1 });
    expect(expense.items[1]).toMatchObject({ planRatio: 0.25, actualRatio: 0 });
    expect(expense.total).toMatchObject({ planRatio: 0.75, actualRatio: 1 });
  });

  it("上位の科目だけ出し、残りは「その他」にまとめる（1 科目だけならまとめない）", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row(i + 1, "EXPENSE", 100, 100 + (i + 1) * 10),
    );
    const [expense] = buildBudgetActualGroups(rows, nameOf, labels, 6);
    expect(expense.items).toHaveLength(7);
    expect(expense.items[0].label).toBe("科目9");
    expect(expense.items[6]).toMatchObject({
      accountId: null,
      label: "その他（3科目）",
      plan: 300,
      actual: 360, // 110 + 120 + 130
      favorable: false,
    });
    expect(buildBudgetActualGroups(rows.slice(0, 7), nameOf, labels, 6)[0].items).toHaveLength(7);
  });

  it("予算が 0 の科目は有利・不利を決めない。予算も実績も無いグループは出さない", () => {
    const groups = buildBudgetActualGroups([row(1, "EXPENSE", 0, 500)], nameOf, labels);
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].favorable).toBeNull();
    expect(buildBudgetActualGroups([row(2, "REVENUE", 0, 0)], nameOf, labels)).toEqual([]);
  });
});
