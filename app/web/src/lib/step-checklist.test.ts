import { describe, expect, it } from "vitest";
import { computeStepChecklist } from "./step-checklist";

describe("computeStepChecklist", () => {
  it("すべて false の場合は 6 ステップすべて未達成", () => {
    const items = computeStepChecklist({
      hasIncomeBudget: false,
      hasExpenseBudget: false,
      hasBankAccount: false,
      hasPersonalAsset: false,
      hasLoan: false,
      hasSwitchedMode: false,
    });
    expect(items).toHaveLength(6);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.map((i) => i.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("すべて true の場合は 6 ステップすべて達成", () => {
    const items = computeStepChecklist({
      hasIncomeBudget: true,
      hasExpenseBudget: true,
      hasBankAccount: true,
      hasPersonalAsset: true,
      hasLoan: true,
      hasSwitchedMode: true,
    });
    expect(items.every((i) => i.done)).toBe(true);
  });

  it("各フィールドが対応するステップの達成状況に正しく反映される", () => {
    const items = computeStepChecklist({
      hasIncomeBudget: true,
      hasExpenseBudget: false,
      hasBankAccount: true,
      hasPersonalAsset: false,
      hasLoan: true,
      hasSwitchedMode: false,
    });
    expect(items.map((i) => i.done)).toEqual([true, false, true, false, true, false]);
  });
});
