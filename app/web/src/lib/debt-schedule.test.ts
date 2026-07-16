import { describe, expect, it } from "vitest";
import { amortizationSchedule, annuityMonthlyPayment, computeDebtSchedule } from "./debt-schedule";

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

describe("annuityMonthlyPayment", () => {
  it("r=0（無利子）は単純な均等割りになる", () => {
    expect(annuityMonthlyPayment(1_200_000, 0, 12)).toBe(100_000);
  });

  it("年利ありの場合は元利均等の月額を計算する（既知値との比較）", () => {
    // 300万円・年利3%・120回（10年）の元利均等月額 ≈ 28,961円
    const payment = annuityMonthlyPayment(3_000_000, 3, 120);
    expect(payment).toBeGreaterThan(28_900);
    expect(payment).toBeLessThan(29_100);
  });

  it("不正な入力は 0 を返す", () => {
    expect(annuityMonthlyPayment(0, 3, 12)).toBe(0);
    expect(annuityMonthlyPayment(1_000_000, 3, 0)).toBe(0);
  });
});

describe("amortizationSchedule", () => {
  it("r=0 のスケジュールは毎月同額の元本返済になり、残高は 0 で終わる", () => {
    const rows = amortizationSchedule(1_200_000, 0, ym(2026, 1), ym(2026, 12));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    expect(rows[0].principal).toBe(100_000);
    expect(rows[rows.length - 1].remaining).toBe(0);
    // Σ元本 = principal を厳密に保証
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(1_200_000);
  });

  it("1ヶ月のみの場合は初回＝最終回として全額清算する", () => {
    const rows = amortizationSchedule(500_000, 3, ym(2026, 1), ym(2026, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0].principal).toBe(500_000);
    expect(rows[0].remaining).toBe(0);
    expect(rows[0].interest).toBe(Math.round(500_000 * (0.03 / 12)));
  });

  it("最終回で丸め誤差を清算し、Σ元本が principal と厳密に一致する", () => {
    // 割り切れない元本・利率で丸め誤差が蓄積しやすいケース
    const rows = amortizationSchedule(1_000_000, 2.5, ym(2026, 1), ym(2027, 11)); // 23ヶ月
    expect(rows).toHaveLength(23);
    expect(rows[rows.length - 1].remaining).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(1_000_000);
  });

  it("monthlyPaymentOverride を渡すと入力値が優先される", () => {
    const computed = annuityMonthlyPayment(2_000_000, 4, 24);
    const overridden = 100_000; // 計算値とは異なる任意の金額
    expect(overridden).not.toBe(computed);

    const rows = amortizationSchedule(2_000_000, 4, ym(2026, 1), ym(2027, 12), overridden);
    // 最終回以外は override 額で支払う
    expect(rows[0].payment).toBe(overridden);
    // それでも Σ元本は厳密に principal と一致する（最終回で清算）
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(2_000_000);
  });

  it("不正な入力は空配列を返す", () => {
    expect(amortizationSchedule(0, 3, ym(2026, 1), ym(2026, 12))).toEqual([]);
    expect(amortizationSchedule(1_000_000, 3, ym(2027, 1), ym(2026, 1))).toEqual([]);
  });
});
