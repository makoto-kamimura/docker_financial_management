import { describe, expect, it } from "vitest";
import {
  amortizationSchedule,
  amortizationScheduleWithRates,
  annuityMonthlyPayment,
  computeDebtSchedule,
  rateResolver,
  recalcMonthlyPaymentAtRateChange,
  ymIndex,
} from "./debt-schedule";

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

describe("rateResolver", () => {
  it("変更前は当初金利、変更日以降は変更後の金利を返す", () => {
    const at = rateResolver(1.0, [{ effectiveYm: 100, rate: 2.0 }]);
    expect(at(99)).toBe(1.0);
    expect(at(100)).toBe(2.0);
    expect(at(101)).toBe(2.0);
  });

  it("複数回の変更を適用日順に反映する（入力順は問わない）", () => {
    const at = rateResolver(1.0, [
      { effectiveYm: 110, rate: 3.0 },
      { effectiveYm: 100, rate: 2.0 },
    ]);
    expect(at(99)).toBe(1.0);
    expect(at(105)).toBe(2.0);
    expect(at(110)).toBe(3.0);
  });
});

describe("amortizationScheduleWithRates", () => {
  const start = new Date(Date.UTC(2026, 0, 1)); // 2026-01
  const end = new Date(Date.UTC(2026, 11, 1)); // 2026-12

  it("金利一定なら amortizationSchedule と一致する", () => {
    const a = amortizationSchedule(1_200_000, 2, start, end);
    const b = amortizationScheduleWithRates(1_200_000, start, end, () => 2);
    expect(b).toEqual(a);
  });

  it("金利上昇後は利息が増える", () => {
    const at = rateResolver(1, [{ effectiveYm: ymIndex(new Date(Date.UTC(2026, 6, 1))), rate: 5 }]);
    const rows = amortizationScheduleWithRates(1_200_000, start, end, at);
    const june = rows[5];
    const july = rows[6];
    expect(july.interest).toBeGreaterThan(june.interest);
  });

  it("返済額を据え置かない場合、金利変更月に月額が再計算される", () => {
    const at = rateResolver(1, [{ effectiveYm: ymIndex(new Date(Date.UTC(2026, 6, 1))), rate: 5 }]);
    const rows = amortizationScheduleWithRates(1_200_000, start, end, at);
    expect(rows[6].payment).toBeGreaterThan(rows[5].payment);
  });

  it("返済額を据え置くと、金利上昇分だけ元本充当が減る", () => {
    const at = rateResolver(1, [{ effectiveYm: ymIndex(new Date(Date.UTC(2026, 6, 1))), rate: 5 }]);
    const rows = amortizationScheduleWithRates(1_200_000, start, end, at, 100_000);
    expect(rows[6].payment).toBe(100_000);
    expect(rows[6].principal).toBeLessThan(rows[5].principal);
  });

  it("最終回で完済し、残高は 0 になる", () => {
    const at = rateResolver(1, [{ effectiveYm: ymIndex(new Date(Date.UTC(2026, 6, 1))), rate: 5 }]);
    const rows = amortizationScheduleWithRates(1_200_000, start, end, at);
    expect(rows.at(-1)!.remaining).toBe(0);
    const totalPrincipal = rows.reduce((s, r) => s + r.principal, 0);
    expect(totalPrincipal).toBe(1_200_000);
  });
});

describe("computeDebtSchedule（年利あり）", () => {
  it("年利を指定すると元利均等の月額になる（無利子より大きい）", () => {
    const noInterest = computeDebtSchedule(
      6_000_000,
      ym(2026, 1),
      ym(2027, 12),
      new Date(2026, 0, 15),
    )!;
    const withInterest = computeDebtSchedule(
      6_000_000,
      ym(2026, 1),
      ym(2027, 12),
      new Date(2026, 0, 15),
      1.2,
    )!;
    expect(withInterest.totalMonths).toBe(noInterest.totalMonths);
    expect(withInterest.monthly).toBeGreaterThan(noInterest.monthly);
  });

  it("年利ありの残高は償還表の元本返済ベースになる（利息分だけ減りが遅い）", () => {
    const noInterest = computeDebtSchedule(
      6_000_000,
      ym(2026, 1),
      ym(2027, 12),
      new Date(2026, 5, 15),
    )!;
    const withInterest = computeDebtSchedule(
      6_000_000,
      ym(2026, 1),
      ym(2027, 12),
      new Date(2026, 5, 15),
      1.2,
    )!;
    expect(withInterest.remaining).toBeGreaterThan(0);
    expect(withInterest.remaining).toBeLessThan(6_000_000);
    // 同じ回数を支払った時点では、利息がある方が元本の減りは遅い
    expect(withInterest.remaining).toBeGreaterThan(noInterest.remaining - withInterest.monthly);
  });

  it("完済予定月を過ぎたら残高 0", () => {
    const s = computeDebtSchedule(6_000_000, ym(2026, 1), ym(2026, 3), new Date(2027, 0, 15), 1.2)!;
    expect(s.remaining).toBe(0);
  });
});

describe("computeDebtSchedule（実額の返済額を指定）", () => {
  it("金利ありでも指定された実額を月額として使う", () => {
    // 4000万・年 0.81%・420回の元利均等は 109,407 円だが、5 年ルールで据え置かれた
    // 実額 109,407 を渡した場合はその額がそのまま月額になる
    const s = computeDebtSchedule(
      40_000_000,
      ym(2026, 3),
      ym(2061, 2),
      new Date(2026, 2, 15),
      1.06,
      109_407,
    )!;
    expect(s.totalMonths).toBe(420);
    expect(s.monthly).toBe(109_407);
  });

  it("実額を渡すと残高もその額で進む（計算値より減りが遅い／速い）", () => {
    const calculated = computeDebtSchedule(
      40_000_000,
      ym(2026, 3),
      ym(2061, 2),
      new Date(2027, 2, 15),
      1.06,
    )!;
    const actual = computeDebtSchedule(
      40_000_000,
      ym(2026, 3),
      ym(2061, 2),
      new Date(2027, 2, 15),
      1.06,
      109_407,
    )!;
    // 実額（109,407）は 1.06% の計算値（114,036）より小さいので元本の減りが遅い
    expect(actual.monthly).toBeLessThan(calculated.monthly);
    expect(actual.remaining).toBeGreaterThan(calculated.remaining);
  });

  it("無利子でも実額を優先する", () => {
    const s = computeDebtSchedule(
      1_200_000,
      ym(2026, 1),
      ym(2026, 12),
      new Date(2026, 0, 15),
      0,
      105_000,
    )!;
    expect(s.monthly).toBe(105_000);
  });
});

describe("recalcMonthlyPaymentAtRateChange", () => {
  const housing = {
    principal: 40_000_000,
    borrowedOn: ym(2026, 3),
    repaymentDate: ym(2061, 2),
    baseRatePercent: 0.81,
    priorChanges: [],
  };

  it("借入月と同月の改定なら当初元本・全回数で計算する", () => {
    const r = recalcMonthlyPaymentAtRateChange({
      ...housing,
      effectiveOn: ym(2026, 3),
      newRatePercent: 0.81,
    })!;
    expect(r.balance).toBe(40_000_000);
    expect(r.remainingMonths).toBe(420);
    expect(r.monthly).toBe(109_407); // 4000万・0.81%・35年の元利均等
  });

  it("「残高 × 残回数」で再計算する（改定月までは従前の実額で残高を進める）", () => {
    // 2026-03〜2026-05 の 3 回を 109,407 で返済 → 2026-06 の改定直前残高は約 3,975 万
    const r = recalcMonthlyPaymentAtRateChange({
      ...housing,
      monthlyPayment: 109_407,
      effectiveOn: ym(2026, 6),
      newRatePercent: 1.06,
    })!;
    expect(r.remainingMonths).toBe(417);
    expect(r.balance).toBeGreaterThan(39_700_000);
    expect(r.balance).toBeLessThan(39_800_000);
    // 都度見直し型ならこの額に改定される（5 年ルール型なら 109,407 のまま据え置き）
    expect(r.monthly).toBeGreaterThan(113_000);
    expect(r.monthly).toBeLessThan(115_000);
  });

  it("先行する金利改定履歴を残高の計算に織り込む", () => {
    const withPrior = recalcMonthlyPaymentAtRateChange({
      ...housing,
      priorChanges: [{ effectiveYm: ymIndex(ym(2026, 6)), rate: 1.06 }],
      monthlyPayment: 109_407,
      effectiveOn: ym(2028, 1),
      newRatePercent: 1.5,
    })!;
    const withoutPrior = recalcMonthlyPaymentAtRateChange({
      ...housing,
      monthlyPayment: 109_407,
      effectiveOn: ym(2028, 1),
      newRatePercent: 1.5,
    })!;
    // 途中で金利が上がっていた方が元本の減りが遅く、改定時点の残高は大きい
    expect(withPrior.balance).toBeGreaterThan(withoutPrior.balance);
  });

  it("完済予定月より後の改定日は null", () => {
    expect(
      recalcMonthlyPaymentAtRateChange({
        ...housing,
        effectiveOn: ym(2061, 3),
        newRatePercent: 1.06,
      }),
    ).toBeNull();
  });
});

describe("残価設定ローン（residualValue）", () => {
  // 実データ: 割賦元金 1,850,380 / 年利 2.9% / 2025-04〜2028-03（36回）/ 残価 1,231,750
  const P = 1_850_380;
  const R = 1_231_750;

  it("残価を除いた分だけ償却するので月額が下がる", () => {
    const withoutResidual = annuityMonthlyPayment(P, 2.9, 36);
    const withResidual = annuityMonthlyPayment(P, 2.9, 36, R);
    expect(withResidual).toBeLessThan(withoutResidual);
    // 実際の請求額 21,500 円に近い値になる（端数処理・初回日割りの差は残る）
    expect(withResidual).toBeGreaterThan(20_000);
    expect(withResidual).toBeLessThan(22_000);
  });

  it("最終回の直前まで残高が残価を下回らない", () => {
    const monthly = annuityMonthlyPayment(P, 2.9, 36, R);
    const rows = amortizationSchedule(P, 2.9, ym(2025, 4), ym(2028, 3), monthly, R);
    expect(rows).toHaveLength(36);
    // 35 回目終了時点の残高 ≒ 残価
    expect(rows[34].remaining).toBeGreaterThan(R * 0.98);
    expect(rows[34].remaining).toBeLessThan(R * 1.02);
    // 最終回で残価を一括支払いして完済
    expect(rows[35].remaining).toBe(0);
    expect(rows[35].payment).toBeGreaterThan(R);
  });

  it("残価なしの場合は従来どおり（既存の挙動を変えない）", () => {
    expect(annuityMonthlyPayment(P, 2.9, 36, 0)).toBe(annuityMonthlyPayment(P, 2.9, 36));
    const a = amortizationSchedule(P, 2.9, ym(2025, 4), ym(2028, 3));
    const b = amortizationSchedule(P, 2.9, ym(2025, 4), ym(2028, 3), undefined, 0);
    expect(b).toEqual(a);
  });

  it("computeDebtSchedule の残高が残価を下回らない", () => {
    // 2026-08 時点（17回目終了）の残高
    const s = computeDebtSchedule(
      P,
      ym(2025, 4),
      ym(2028, 3),
      new Date(2026, 7, 15),
      2.9,
      21_500,
      R,
    )!;
    expect(s.totalMonths).toBe(36);
    expect(s.paidMonths).toBe(17);
    expect(s.monthly).toBe(21_500);
    expect(s.remaining).toBeGreaterThan(R);
  });

  it("無利子でも残価を除いた分を月割りする", () => {
    const s = computeDebtSchedule(
      1_200_000,
      ym(2026, 1),
      ym(2026, 12),
      new Date(2026, 0, 15),
      0,
      undefined,
      600_000,
    )!;
    expect(s.monthly).toBe(50_000); // (1,200,000 - 600,000) / 12
  });

  it("残価が元本以上なら毎月の元本償却は発生しない", () => {
    expect(annuityMonthlyPayment(1_000_000, 0, 12, 1_000_000)).toBe(0);
    expect(annuityMonthlyPayment(1_000_000, 0, 12, 2_000_000)).toBe(0);
  });

  it("金利改定時の再計算も残価を考慮する", () => {
    const withResidual = recalcMonthlyPaymentAtRateChange({
      principal: P,
      borrowedOn: ym(2025, 4),
      repaymentDate: ym(2028, 3),
      baseRatePercent: 2.9,
      priorChanges: [],
      monthlyPayment: 21_500,
      effectiveOn: ym(2026, 4),
      newRatePercent: 3.5,
      residualValue: R,
    })!;
    const withoutResidual = recalcMonthlyPaymentAtRateChange({
      principal: P,
      borrowedOn: ym(2025, 4),
      repaymentDate: ym(2028, 3),
      baseRatePercent: 2.9,
      priorChanges: [],
      monthlyPayment: 21_500,
      effectiveOn: ym(2026, 4),
      newRatePercent: 3.5,
    })!;
    expect(withResidual.monthly).toBeLessThan(withoutResidual.monthly);
  });
});
