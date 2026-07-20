import type { Loan, PersonalAsset } from "@prisma/client";
import { computeDebtSchedule, ymIndex, type DebtSchedule } from "@/lib/debt-schedule";

// D-4: 実物資産の紐付け負債は Loan に一本化された。本モジュールは
// 「旧 debtStartOn/debtPayoffDue/debtInitialAmount の API 契約」と Loan の相互変換を担う。

// 資産紐付け負債として作成する Loan の loanType 識別子
export const ASSET_DEBT_LOAN_TYPE = "asset";

export type DebtInput = {
  debtStartOn: Date | null;
  debtPayoffDue: Date | null;
  debtInitialAmount: number | null;
};

// 負債入力（3 点セット）から Loan 作成用データを組み立てる。3 点が揃わなければ null（負債なし）
export function buildDebtLoanData(assetName: string, input: DebtInput) {
  const { debtStartOn, debtPayoffDue, debtInitialAmount } = input;
  if (!debtStartOn || !debtPayoffDue || debtInitialAmount === null || debtInitialAmount <= 0) {
    return null;
  }
  const schedule = computeDebtSchedule(debtInitialAmount, debtStartOn, debtPayoffDue);
  if (!schedule) return null;
  return {
    lenderName: assetName,
    amount: debtInitialAmount,
    interestRate: 0,
    borrowedOn: debtStartOn,
    repaymentDate: debtPayoffDue,
    remainingAmount: schedule.remaining,
    status: schedule.remaining > 0 ? "active" : "repaid",
    loanType: ASSET_DEBT_LOAN_TYPE,
    monthlyPayment: schedule.monthly,
    note: `実物資産「${assetName}」の紐付け負債`,
  };
}

// Loan を旧 API 契約（debt* フィールド）へ読み替えて資産レスポンスを組み立てる
export function serializeAssetWithDebt(
  asset: PersonalAsset & { loan: Loan | null },
  schedule: DebtSchedule | null,
) {
  const { loan, loanId: _loanId, ...rest } = asset;
  return {
    ...rest,
    debtStartOn: loan?.borrowedOn ?? null,
    debtPayoffDue: loan?.repaymentDate ?? null,
    debtInitialAmount: loan?.amount ?? null,
    debtMonthly: schedule?.monthly ?? null,
    debtRemaining: schedule?.remaining ?? null,
    debtRemainingMonths: schedule ? schedule.totalMonths - schedule.paidMonths : null,
  };
}

// 予算オーバーレイの対象月かどうか（開始月〜解消予定月の inclusive 判定）
export function isDebtActiveMonth(loan: Loan, year: number, month: number): boolean {
  const ym = year * 12 + (month - 1);
  return ym >= ymIndex(loan.borrowedOn) && ym <= ymIndex(loan.repaymentDate);
}
