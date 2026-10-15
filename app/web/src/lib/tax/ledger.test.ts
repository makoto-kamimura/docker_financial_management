import { describe, expect, it } from "vitest";
import { ledgerPlan, mergePlanned, planFromMonth } from "./ledger";

/** 月 → 額 から、添字 1〜12 の配列を作る */
const months = (values: Record<number, number>) =>
  Array.from({ length: 13 }, (_, m) => values[m] ?? 0);

const oct15 = new Date(2026, 9, 15);

describe("planFromMonth / ledgerPlan", () => {
  it("過去の年はすべて実績、今年は今月から、来年以降はすべて予定", () => {
    expect(planFromMonth(2025, oct15)).toBeNull();
    expect(planFromMonth(2026, oct15)).toBe(10);
    expect(planFromMonth(2027, oct15)).toBe(1);
    expect(ledgerPlan(2025, oct15).status).toBe("actual");
    expect(ledgerPlan(2026, oct15).status).toBe("mixed");
    expect(ledgerPlan(2027, oct15).status).toBe("plan");
  });
});

describe("mergePlanned", () => {
  const actual = months({ 1: 300, 9: 300, 10: 100 });
  const budget = months({ 9: 999, 10: 300, 11: 300, 12: 300 });

  it("過去の年は実績だけ（予算は足さない）", () => {
    expect(mergePlanned(actual, budget, null)).toEqual({ total: 700, planned: 0 });
  });

  it("入力月より前は実績、入力月以降は実績と予算の大きい方", () => {
    // 1・9 月は実績（9 月の予算は見ない）、10 月は予算 300 ＞ 実績 100、11・12 月は予算
    expect(mergePlanned(actual, budget, 10)).toEqual({ total: 1_500, planned: 900 });
  });

  it("予算の無い突発の支出は、入力月以降でも実績を残す", () => {
    expect(mergePlanned(months({ 10: 50_000 }), months({}), 10)).toEqual({
      total: 50_000,
      planned: 50_000,
    });
  });

  it("来年以降はすべて予算（実績があれば大きい方）", () => {
    expect(mergePlanned(months({}), months({ 1: 10, 12: 20 }), 1)).toEqual({
      total: 30,
      planned: 30,
    });
  });
});
