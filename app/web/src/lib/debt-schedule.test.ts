import { describe, expect, it } from "vitest";
import { computeDebtSchedule } from "./debt-schedule";

const ym = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

describe("computeDebtSchedule", () => {
  it("開始月〜解消予定月の月数で均等割りする", () => {
    // 2026-01〜2027-12 の24回払い、600万円 → 月25万円
    const s = computeDebtSchedule(6_000_000, ym(2026, 1), ym(2027, 12), new Date(2026, 0, 15));
    expect(s).not.toBeNull();
    expect(s!.totalMonths).toBe(24);
    expect(s!.monthly).toBe(250_000);
    expect(s!.paidMonths).toBe(1); // 開始月に1回目を支払い済み
    expect(s!.remaining).toBe(5_750_000);
  });

  it("経過月数に応じて残高が減る", () => {
    const s = computeDebtSchedule(6_000_000, ym(2026, 1), ym(2027, 12), new Date(2026, 6, 1));
    expect(s!.paidMonths).toBe(7); // 2026-01〜2026-07
    expect(s!.remaining).toBe(6_000_000 - 250_000 * 7);
  });

  it("支払い開始前は残高が当初負債額のまま", () => {
    const s = computeDebtSchedule(6_000_000, ym(2026, 1), ym(2027, 12), new Date(2025, 5, 1));
    expect(s!.paidMonths).toBe(0);
    expect(s!.remaining).toBe(6_000_000);
  });

  it("解消予定月を過ぎたら残高0", () => {
    const s = computeDebtSchedule(6_000_000, ym(2026, 1), ym(2027, 12), new Date(2028, 0, 1));
    expect(s!.paidMonths).toBe(24);
    expect(s!.remaining).toBe(0);
  });

  it("割り切れない場合も残高が負にならない", () => {
    // 100万円を3回払い → 月33.3万円（四捨五入 333,333円）
    const s = computeDebtSchedule(1_000_000, ym(2026, 1), ym(2026, 3), new Date(2026, 1, 1));
    expect(s!.monthly).toBe(333_333);
    expect(s!.remaining).toBe(1_000_000 - 333_333 * 2);
  });

  it("不正な入力は null を返す", () => {
    // 解消予定が開始より前
    expect(computeDebtSchedule(1_000_000, ym(2027, 1), ym(2026, 1))).toBeNull();
    // 金額が0以下
    expect(computeDebtSchedule(0, ym(2026, 1), ym(2027, 1))).toBeNull();
  });
});
