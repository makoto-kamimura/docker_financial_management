import { describe, expect, it } from "vitest";
import { defaultCycleKey, monthInYear, previousMonthKey } from "@/lib/shared/cycle-month";

describe("previousMonthKey", () => {
  it("前月を返す（1 月は前年 12 月）", () => {
    expect(previousMonthKey(new Date(2026, 9, 6))).toBe("2026-09");
    expect(previousMonthKey(new Date(2026, 0, 15))).toBe("2025-12");
  });
});

describe("defaultCycleKey", () => {
  const now = new Date(2026, 9, 6);

  it("予実差確認は最後に実績を確定した月、予算の確定と実績の確定はその翌月", () => {
    expect(defaultCycleKey("2026-06", "variance", now)).toBe("2026-06");
    expect(defaultCycleKey("2026-06", "budget", now)).toBe("2026-07");
    expect(defaultCycleKey("2026-06", "actuals", now)).toBe("2026-07");
  });

  it("12 月の翌月は翌年 1 月", () => {
    expect(defaultCycleKey("2025-12", "budget", now)).toBe("2026-01");
  });

  it("実績を一度も確定していなければ、どの画面も前月", () => {
    for (const kind of ["variance", "budget", "actuals"] as const) {
      expect(defaultCycleKey(null, kind, now)).toBe("2026-09");
    }
  });
});

describe("monthInYear", () => {
  it("年が同じならその月", () => {
    expect(monthInYear("2026-07", 2026)).toBe(7);
  });

  it("メニューの年の方が前なら 12 月、後なら 1 月", () => {
    expect(monthInYear("2026-07", 2025)).toBe(12);
    expect(monthInYear("2026-07", 2027)).toBe(1);
  });
});
