import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { loanBalanceAt, type LoanForBalance } from "@/lib/loan-balance";

const D = (v: number) => new Prisma.Decimal(v);
const loan = (over: Partial<LoanForBalance> = {}): LoanForBalance => ({
  amount: D(1_200_000),
  // DB の日付は UTC の 0 時
  borrowedOn: new Date(Date.UTC(2026, 0, 1)),
  repaymentDate: new Date(Date.UTC(2026, 11, 1)),
  interestRate: D(0),
  monthlyPayment: null,
  monthlyPaymentIsManual: false,
  residualValue: null,
  remainingAmount: D(1_200_000),
  repayments: [],
  ...over,
});

describe("loanBalanceAt", () => {
  it("返済の記録が無ければ返済予定どおりに減る（無利子・12 回なら毎月 10 万円）", () => {
    expect(loanBalanceAt(loan(), new Date(2026, 2, 15))).toBe(900_000);
    expect(loanBalanceAt(loan(), new Date(2027, 0, 15))).toBe(0);
  });

  it("返済の記録があれば、その時点までに返した元金を引く", () => {
    const l = loan({
      repayments: [
        { repaidOn: new Date(2026, 1, 27), principal: D(50_000) },
        { repaidOn: new Date(2026, 2, 27), principal: D(50_000) },
      ],
    });
    expect(loanBalanceAt(l, new Date(2026, 2, 1))).toBe(1_150_000);
    expect(loanBalanceAt(l, new Date(2026, 3, 1))).toBe(1_100_000);
  });

  it("借りる前の時点は 0", () => {
    expect(loanBalanceAt(loan(), new Date(2025, 11, 31))).toBe(0);
  });
});
