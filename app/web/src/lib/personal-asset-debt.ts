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
  /** 年利。Loan.interestRate と同じ小数表記（0.0081 = 0.810%）。null / 未指定は 0（無利子） */
  debtInterestRate?: number | null;
  /** 残価設定ローンの据置額（最終回に一括支払い）。null / 未指定は 0（通常ローン） */
  debtResidualValue?: number | null;
};

// Loan.interestRate（小数）→ 償還計算が受け取る年利（%）
export const ratePercentOf = (rate: number | null | undefined) => Number(rate ?? 0) * 100;

// 実額として入力済みの月々返済額。償還計算の monthlyPaymentOverride に渡す。
// 未入力（自動計算のまま）なら undefined を返し、従来どおり金利から計算させる。
export const manualMonthlyPaymentOf = (
  loan: Pick<Loan, "monthlyPayment" | "monthlyPaymentIsManual"> | null | undefined,
): number | undefined =>
  loan?.monthlyPaymentIsManual && loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined;

// 負債入力（3 点セット）から Loan 作成用データを組み立てる。3 点が揃わなければ null（負債なし）
export function buildDebtLoanData(
  assetName: string,
  input: DebtInput,
  /**
   * 実額として入力済みの月々返済額（Loan.monthlyPaymentIsManual が true のとき既存値を渡す）。
   * 指定するとこの額を維持し、残高もこの額で進める。変動金利の 5 年ルールにより計算値と
   * 実際の請求額は一致しないため、資産側の編集で実額を潰さないようにする。
   */
  manualMonthlyPayment?: number | null,
) {
  const { debtStartOn, debtPayoffDue, debtInitialAmount } = input;
  const debtInterestRate = input.debtInterestRate ?? 0;
  if (!debtStartOn || !debtPayoffDue || debtInitialAmount === null || debtInitialAmount <= 0) {
    return null;
  }
  const manual =
    manualMonthlyPayment && manualMonthlyPayment > 0 ? manualMonthlyPayment : undefined;
  const residualValue = input.debtResidualValue ?? 0;
  const schedule = computeDebtSchedule(
    debtInitialAmount,
    debtStartOn,
    debtPayoffDue,
    new Date(),
    ratePercentOf(debtInterestRate),
    manual,
    residualValue,
  );
  if (!schedule) return null;
  return {
    lenderName: assetName,
    amount: debtInitialAmount,
    interestRate: debtInterestRate,
    borrowedOn: debtStartOn,
    repaymentDate: debtPayoffDue,
    remainingAmount: schedule.remaining,
    status: schedule.remaining > 0 ? "active" : "repaid",
    loanType: ASSET_DEBT_LOAN_TYPE,
    monthlyPayment: manual ?? schedule.monthly,
    residualValue: residualValue > 0 ? residualValue : null,
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
    debtInterestRate: loan?.interestRate ?? null,
    debtResidualValue: loan?.residualValue ?? null,
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
