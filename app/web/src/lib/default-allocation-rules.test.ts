import { describe, it, expect } from "vitest";
import { DEFAULT_ALLOCATION_RULES } from "./default-allocation-rules";
import { HOME_ACCOUNTS_SEED } from "./default-accounts";

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

  it("紐付け科目コードは家庭モード既定科目に実在する", () => {
    const codes = new Set<string>(HOME_ACCOUNTS_SEED.map((a) => a.code));
    for (const r of DEFAULT_ALLOCATION_RULES) {
      if (r.accountCode !== null) {
        expect(codes.has(r.accountCode), `${r.key}: ${r.accountCode}`).toBe(true);
      }
    }
  });
});
