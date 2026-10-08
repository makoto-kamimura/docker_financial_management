import type { Loan, LoanRepayment } from "@prisma/client";
import { computeDebtSchedule } from "@/lib/shared/debt-schedule";
import { manualMonthlyPaymentOf, ratePercentOf } from "@/lib/assets/personal-asset-debt";

// 借入金の残高（ある時点の値）。借入金管理・ダッシュボードの総資産サマリ・資産管理の表示で同じものを使う。
//   - 返済の記録があるローン: 借入額 −（その時点までに返した元金の合計）。今の時点なら remainingAmount と一致する
//   - 返済の記録が無いローン: 返済予定から計算した、その時点の残高（金利・実額の月額・残価を考える）
//   - 借りる前の時点は 0

export type LoanForBalance = Pick<
  Loan,
  | "amount"
  | "borrowedOn"
  | "repaymentDate"
  | "interestRate"
  | "monthlyPayment"
  | "monthlyPaymentIsManual"
  | "residualValue"
  | "remainingAmount"
> & { repayments: Pick<LoanRepayment, "repaidOn" | "principal">[] };

export function loanBalanceAt(loan: LoanForBalance, asOf: Date = new Date()): number {
  if (asOf < loan.borrowedOn) return 0;
  if (loan.repayments.length > 0) {
    const paid = loan.repayments
      .filter((r) => r.repaidOn <= asOf)
      .reduce((sum, r) => sum + Number(r.principal), 0);
    return Math.max(0, Math.round(Number(loan.amount) - paid));
  }
  const schedule = computeDebtSchedule(
    Number(loan.amount),
    loan.borrowedOn,
    loan.repaymentDate,
    asOf,
    ratePercentOf(Number(loan.interestRate)),
    manualMonthlyPaymentOf(loan),
    Number(loan.residualValue ?? 0),
  );
  return schedule ? schedule.remaining : Number(loan.remainingAmount);
}

/** 借入金の一覧・更新のレスポンスに付けるもの（返済・金利変更の履歴、予算連携先、ひも付いた資産） */
export const LOAN_INCLUDE = {
  repayments: { orderBy: { repaidOn: "desc" as const } },
  rateChanges: { orderBy: { effectiveOn: "asc" as const } },
  linkedAccount: { select: { id: true, code: true, name: true } },
  personalAsset: { select: { id: true, name: true, category: true } },
  debitBankAccount: { select: { id: true, name: true } },
};
