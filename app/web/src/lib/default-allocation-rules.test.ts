import { describe, it, expect } from "vitest";
import { DEFAULT_ALLOCATION_RULES } from "./default-allocation-rules";

describe("既定の予算配分ルール", () => {
  it("key が一意である", () => {
    const keys = DEFAULT_ALLOCATION_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("割合が 0-100 の範囲で min <= max を満たす", () => {
    for (const r of DEFAULT_ALLOCATION_RULES) {
      expect(r.minPercent, r.key).toBeGreaterThanOrEqual(0);
      expect(r.minPercent, r.key).toBeLessThanOrEqual(100);
      if (r.maxPercent !== null) {
        expect(r.maxPercent, r.key).toBeLessThanOrEqual(100);
        expect(r.minPercent, r.key).toBeLessThanOrEqual(r.maxPercent);
      }
    }
  });

  it("下限の合計が 100% を超えない（配分として成立する）", () => {
    const totalMin = DEFAULT_ALLOCATION_RULES.reduce((s, r) => s + r.minPercent, 0);
    expect(totalMin).toBeLessThanOrEqual(100);
  });

  it("受け皿は区分ごとに 1 つだけ", () => {
    const fallbacks = DEFAULT_ALLOCATION_RULES.filter((r) => r.fallbackCategory).map(
      (r) => r.fallbackCategory,
    );
    expect(new Set(fallbacks).size).toBe(fallbacks.length);
    expect(fallbacks.sort()).toEqual(["COGS", "EXPENSE"]);
  });
});
