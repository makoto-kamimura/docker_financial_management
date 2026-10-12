import { describe, expect, it } from "vitest";
import { splitRuleTarget, suggestAllocation, type AllocationRule } from "@/lib/budget/allocation";

const rentRule: AllocationRule = {
  id: 1,
  key: "rent",
  label: "家賃",
  group: "固定費",
  minPercent: 20,
  maxPercent: 30,
  sortOrder: 0,
};

const savingsRule: AllocationRule = {
  id: 2,
  key: "savings",
  label: "貯蓄",
  group: "その他",
  minPercent: 20,
  maxPercent: null,
  sortOrder: 1,
};

const foodRule: AllocationRule = {
  id: 3,
  key: "food",
  label: "食費",
  group: "生活費",
  minPercent: 15,
  maxPercent: 20,
  sortOrder: 2,
};

describe("suggestAllocation", () => {
  it("computes min/max/recommended with HALF_UP rounding", () => {
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [],
      rules: [rentRule],
    });
    expect(result.available).toBe(300_000);
    const item = result.items[0];
    expect(item.min).toBe(60_000); // 300000 * 20%
    expect(item.max).toBe(90_000); // 300000 * 30%
    expect(item.recommended).toBe(75_000); // 300000 * 25%
  });

  it("uses minPercent as recommended when maxPercent is null (no upper bound)", () => {
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [],
      rules: [savingsRule],
    });
    const item = result.items[0];
    expect(item.max).toBeNull();
    expect(item.min).toBe(60_000);
    expect(item.recommended).toBe(60_000);
  });

  it("deducts overlay amounts (loan repayments etc.) from the available amount", () => {
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [{ accountId: 99, amount: 100_000 }],
      rules: [rentRule],
    });
    expect(result.available).toBe(200_000);
    expect(result.items[0].recommended).toBe(50_000); // 200000 * 25%
  });

  it("counts an overlay inside a rule as part of that rule's target instead of deducting it", () => {
    // 家賃に連携した住宅ローン 60,000: 基準額からは引かず、家賃の目標 75,000 の一部として数える
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [{ accountId: 99, amount: 60_000, ruleId: rentRule.id }],
      rules: [rentRule, foodRule],
    });
    expect(result.available).toBe(300_000);
    expect(result.items[0].recommended).toBe(75_000);
    expect(result.items[0].overlay).toBe(60_000);
    expect(result.items[1].overlay).toBe(0);
    expect(result.totalRecommended).toBe(75_000 + 52_500);
    expect(result.overRecommended).toBe(false);
  });

  it("counts the overlay when it exceeds the rule's target, and flags overRecommended", () => {
    const result = suggestAllocation({
      basisAmount: 100_000,
      overlays: [{ accountId: 99, amount: 90_000, ruleId: rentRule.id }],
      rules: [rentRule, foodRule],
    });
    expect(result.items[0].recommended).toBe(25_000);
    expect(result.totalRecommended).toBe(90_000 + 17_500);
    expect(result.summary503020.needs).toBe(90_000);
    expect(result.overRecommended).toBe(true);
  });

  it("deducts an overlay whose rule is unknown, as outside the allocation", () => {
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [{ accountId: 99, amount: 100_000, ruleId: 999 }],
      rules: [rentRule],
    });
    expect(result.available).toBe(200_000);
    expect(result.items[0].overlay).toBe(0);
  });

  it("clamps available to 0 when overlays exceed the basis amount, never negative", () => {
    const result = suggestAllocation({
      basisAmount: 50_000,
      overlays: [{ accountId: 99, amount: 100_000 }],
      rules: [rentRule],
    });
    expect(result.available).toBe(0);
    expect(result.items[0].recommended).toBe(0);
    expect(result.overRecommended).toBe(false);
  });

  it("returns all zeros when income (basisAmount) is 0", () => {
    const result = suggestAllocation({
      basisAmount: 0,
      overlays: [],
      rules: [rentRule, savingsRule],
    });
    expect(result.available).toBe(0);
    for (const item of result.items) {
      expect(item.recommended).toBe(0);
    }
    expect(result.totalRecommended).toBe(0);
  });

  it("flags overRecommended when the sum of recommended amounts exceeds the available amount", () => {
    const heavyRules: AllocationRule[] = [
      { ...rentRule, minPercent: 60, maxPercent: 60 },
      { ...savingsRule, minPercent: 60, maxPercent: null },
    ];
    const result = suggestAllocation({ basisAmount: 100_000, overlays: [], rules: heavyRules });
    expect(result.totalRecommended).toBe(120_000);
    expect(result.overRecommended).toBe(true);
  });

  it("buckets recommended amounts into needs/wants/savings by rule group (50/30/20 summary)", () => {
    const result = suggestAllocation({
      basisAmount: 300_000,
      overlays: [],
      rules: [rentRule, foodRule, savingsRule],
    });
    expect(result.summary503020.needs).toBe(result.items[0].recommended); // 固定費
    expect(result.summary503020.wants).toBe(result.items[1].recommended); // 生活費
    expect(result.summary503020.savings).toBe(result.items[2].recommended); // その他
  });
});

describe("splitRuleTarget", () => {
  const noWeights = new Map<number, number>();

  it("fills the rest of the target into accounts without an overlay", () => {
    // 家賃（ローン 60,000）と管理費: 目標 75,000 の残り 15,000 を管理費へ
    const split = splitRuleTarget({
      target: 75_000,
      accountIds: [1, 2],
      overlayByAccount: new Map([[1, 60_000]]),
      weights: noWeights,
    });
    expect(Object.fromEntries(split)).toEqual({ 2: 15_000 });
  });

  it("puts nothing when the overlay already covers the target", () => {
    const split = splitRuleTarget({
      target: 75_000,
      accountIds: [1, 2],
      overlayByAccount: new Map([[1, 80_000]]),
      weights: noWeights,
    });
    expect(split.size).toBe(0);
  });

  it("splits the whole target over overlay accounts when they are the only members", () => {
    const split = splitRuleTarget({
      target: 75_000,
      accountIds: [1, 3],
      overlayByAccount: new Map([
        [1, 60_000],
        [3, 20_000],
      ]),
      weights: noWeights,
    });
    expect(Object.fromEntries(split)).toEqual({ 1: 56_250, 3: 18_750 });
  });

  it("behaves like a plain split when there is no overlay", () => {
    const split = splitRuleTarget({
      target: 30_000,
      accountIds: [1, 2],
      overlayByAccount: new Map(),
      weights: new Map([
        [1, 2],
        [2, 1],
      ]),
    });
    expect(Object.fromEntries(split)).toEqual({ 1: 20_000, 2: 10_000 });
  });
});
