import { computeDebtSchedule } from "@/lib/debt-schedule";
import { manualMonthlyPaymentOf, ratePercentOf } from "@/lib/personal-asset-debt";
import type { Loan } from "@prisma/client";

// 毎月のお金の動き（資金移動ルール）。fromId/toId は口座(number)または外部(null)。
export type FundingTransfer = {
  fromId: number | null;
  toId: number | null;
  amount: number;
  day: number;
  /** 表示用のラベル（未設定なら種別名などを呼び出し側で入れる） */
  label: string | null;
  /** この月（"YYYY-MM"）から有効。無ければ期限なし（借入の返済は借入日の月から） */
  activeFrom?: string;
  /** この月（"YYYY-MM"）まで有効。無ければ期限なし（借入の返済は完済予定の月まで） */
  activeUntil?: string;
};

// 借入の返済を、残高の推移の見込みの「毎月のお金の動き」として並べる。
// 借入金管理で引き落とし口座と日を入れた、返済中の借入が対象。月々の返済額を、借入日の月から完済予定の月まで、
// その口座からの出金として扱う。同じ口座・日・金額（±1%）の資金移動ルールがあれば、そちらを使い入れない
// （手で登録したルールと二重に数えないため）。

export type LoanForFunding = Pick<
  Loan,
  | "id"
  | "lenderName"
  | "status"
  | "amount"
  | "borrowedOn"
  | "repaymentDate"
  | "interestRate"
  | "monthlyPayment"
  | "monthlyPaymentIsManual"
  | "residualValue"
  | "debitBankAccountId"
  | "debitDay"
>;

export type RuleForMatch = { fromId: number | null; day: number; amount: number };

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** 借入の月々の返済額（入力した額があればその額、無ければ返済予定から計算した額） */
export function loanMonthlyPayment(loan: LoanForFunding): number {
  if (loan.monthlyPayment !== null) return Number(loan.monthlyPayment);
  const schedule = computeDebtSchedule(
    Number(loan.amount),
    loan.borrowedOn,
    loan.repaymentDate,
    new Date(),
    ratePercentOf(Number(loan.interestRate)),
    manualMonthlyPaymentOf(loan),
    Number(loan.residualValue ?? 0),
  );
  return schedule?.monthly ?? 0;
}

/** 同じ返済の資金移動ルール（同じ口座・日・金額 ±1%）があるか */
export function hasMatchingRule(
  debitAccountId: number,
  day: number,
  amount: number,
  rules: RuleForMatch[],
): boolean {
  return rules.some(
    (r) =>
      r.fromId === debitAccountId && r.day === day && Math.abs(r.amount - amount) <= amount * 0.01,
  );
}

export type LoanFundingResult = {
  /** 資金繰りに足す、借入の返済（借入 id つき） */
  transfers: (FundingTransfer & { loanId: number })[];
  /** 同じ資金移動ルールがあるため入れなかった借入の id */
  coveredByRule: number[];
};

export function loanFundingTransfers(
  loans: LoanForFunding[],
  rules: RuleForMatch[],
): LoanFundingResult {
  const transfers: LoanFundingResult["transfers"] = [];
  const coveredByRule: number[] = [];
  for (const loan of loans) {
    if (loan.status !== "active" || loan.debitBankAccountId === null || loan.debitDay === null)
      continue;
    const amount = Math.round(loanMonthlyPayment(loan));
    if (amount <= 0) continue;
    if (hasMatchingRule(loan.debitBankAccountId, loan.debitDay, amount, rules)) {
      coveredByRule.push(loan.id);
      continue;
    }
    transfers.push({
      loanId: loan.id,
      fromId: loan.debitBankAccountId,
      toId: null,
      amount,
      day: loan.debitDay,
      label: `借入返済: ${loan.lenderName}`,
      activeFrom: ym(loan.borrowedOn),
      activeUntil: ym(loan.repaymentDate),
    });
  }
  return { transfers, coveredByRule };
}
