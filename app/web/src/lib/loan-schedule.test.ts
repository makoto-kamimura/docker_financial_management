import { describe, expect, it } from "vitest";
import {
  balanceKey,
  buildRateComparison,
  buildScheduleData,
  originalRatePercent,
  pendingRateChange,
  referenceMonthly,
  type Loan,
  type LoanRateChange,
} from "./loan-schedule";

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    lenderName: "A銀行",
    amount: "1200000",
    interestRate: "0.01",
    rateChanges: [],
    borrowedOn: "2020-01-15",
    repaymentDate: "2029-12-15",
    remainingAmount: "600000",
    status: "active",
    note: null,
    loanType: "housing",
    linkedAccountId: null,
    linkedAccount: null,
    monthlyPayment: null,
    residualValue: null,
    monthlyPaymentIsManual: false,
    repayments: [],
    ...overrides,
  };
}

function change(overrides: Partial<LoanRateChange> = {}): LoanRateChange {
  return {
    id: 1,
    effectiveOn: "2024-04-01",
    interestRate: "0.015",
    previousRate: "0.01",
    monthlyPayment: null,
    previousMonthlyPayment: null,
    calculatedMonthlyPayment: null,
    note: null,
    ...overrides,
  };
}

describe("originalRatePercent", () => {
  it("金利変更が無ければ現在の金利（%）", () => {
    expect(originalRatePercent(loan())).toBeCloseTo(1);
  });

  it("金利変更があれば最初の変更の変更前金利", () => {
    const l = loan({
      interestRate: "0.02",
      rateChanges: [
        change({ id: 2, effectiveOn: "2025-04-01", previousRate: "0.015", interestRate: "0.02" }),
        change({ id: 1, effectiveOn: "2024-04-01", previousRate: "0.01", interestRate: "0.015" }),
      ],
    });
    expect(originalRatePercent(l)).toBeCloseTo(1);
  });
});

describe("pendingRateChange", () => {
  it("最新の改定で実額が未入力ならその改定を返す", () => {
    const pending = change({ id: 2, effectiveOn: "2025-04-01" });
    const l = loan({ rateChanges: [change({ id: 1, monthlyPayment: "10000" }), pending] });
    expect(pendingRateChange(l)?.id).toBe(2);
  });

  it("最新の改定の実額が入力済みなら null（古い未入力は対象外）", () => {
    const l = loan({
      rateChanges: [
        change({ id: 1 }),
        change({ id: 2, effectiveOn: "2025-04-01", monthlyPayment: "10500" }),
      ],
    });
    expect(pendingRateChange(l)).toBeNull();
  });
});

describe("referenceMonthly", () => {
  it("改定日から完済までの残回数と参考月額を返す", () => {
    const ref = referenceMonthly(loan(), "2025-01-10", 0.02);
    expect(ref).not.toBeNull();
    // 2025/01〜2029/12 の 60 回
    expect(ref!.remainingMonths).toBe(60);
    expect(ref!.monthly).toBeGreaterThan(0);
    expect(ref!.balance).toBeLessThan(1200000);
  });

  it("日付や金利が不正なら null", () => {
    expect(referenceMonthly(loan(), "not-a-date", 0.02)).toBeNull();
    expect(referenceMonthly(loan(), "2025-01-10", -1)).toBeNull();
  });
});

describe("buildRateComparison", () => {
  it("金利変更が無いローンは null", () => {
    expect(buildRateComparison(loan())).toBeNull();
  });

  it("金利が上がると変動後の総利息が増える", () => {
    const cmp = buildRateComparison(
      loan({ interestRate: "0.03", rateChanges: [change({ interestRate: "0.03" })] }),
    );
    expect(cmp).not.toBeNull();
    expect(cmp!.afterInterest).toBeGreaterThan(cmp!.beforeInterest);
    expect(cmp!.points.length).toBe(120);
  });
});

describe("buildScheduleData", () => {
  it("ローンが無ければ空", () => {
    expect(buildScheduleData([])).toEqual([]);
  });

  it("借入月から完済月までの月次の点を作り、借入前の月には値を入れない", () => {
    const a = loan({ id: 1, borrowedOn: "2020-01-15", repaymentDate: "2021-12-15" });
    const b = loan({ id: 2, borrowedOn: "2021-01-15", repaymentDate: "2021-12-15" });
    const points = buildScheduleData([a, b]);
    expect(points[0].date).toBe("2020/01");
    expect(points[points.length - 1].date).toBe("2021/12");
    expect(points.length).toBe(24);
    expect(points[0][balanceKey(1)]).toBeDefined();
    expect(points[0][balanceKey(2)]).toBeUndefined();
  });

  // 各月の点は月初時点の残高なので、月の途中の返済は翌月の点から反映される
  it("実績返済は返済日の翌月初の残高から差し引く", () => {
    const l = loan({
      borrowedOn: "2020-01-15",
      repaymentDate: "2020-06-15",
      repayments: [
        {
          id: 1,
          repaidOn: "2020-03-10",
          principal: "200000",
          interest: "0",
          totalAmount: "200000",
        },
      ],
    });
    const points = buildScheduleData([l]);
    const before = points.find((p) => p.date === "2020/03")!;
    const after = points.find((p) => p.date === "2020/04")!;
    expect(before[balanceKey(1)]).toBe(1200000);
    expect(after[balanceKey(1)]).toBe(1000000);
  });
});
