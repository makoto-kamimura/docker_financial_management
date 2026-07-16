export type DebtSchedule = {
  totalMonths: number; // 支払い回数（開始月〜解消予定月）
  monthly: number; // 月割り額（円・四捨五入）
  paidMonths: number; // 経過（支払い済み）回数
  remaining: number; // 現在の負債残高
};

export function ymIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// 元利均等返済の月額を算出する。r=0（無利子）は元本の単純割り（P/n）。
// このリポジトリの数値計算は既存 computeDebtSchedule と同様プレーンな number で統一する
// （decimal.js 等の新規依存を避けるため）。金額は最終的に円単位で四捨五入する。
export function annuityMonthlyPayment(
  principal: number,
  annualRatePercent: number,
  months: number,
): number {
  if (!(principal > 0) || months <= 0) return 0;
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return Math.round(principal / months);
  const factor = Math.pow(1 + r, months);
  return Math.round((principal * r * factor) / (factor - 1));
}

export type AmortizationRow = {
  ym: number; // ymIndex() 基準の年月インデックス
  payment: number;
  principal: number;
  interest: number;
  remaining: number; // この回の返済後の残高
};

// 月別償還スケジュールを生成する。monthlyPaymentOverride を渡すとその金額を毎月の返済額として使う
// （入力値優先。design 通り未入力時のみ annuityMonthlyPayment() で計算する）。
// 最終回は利息を差し引いた残り全額を元本返済に充てることで、Σ元本 = principal を厳密に保証する
// （毎月一定額を丸めることによる誤差を最終回に吸収する）。
export function amortizationSchedule(
  principal: number,
  annualRatePercent: number,
  startOn: Date,
  endOn: Date,
  monthlyPaymentOverride?: number,
): AmortizationRow[] {
  const startYm = ymIndex(startOn);
  const endYm = ymIndex(endOn);
  const months = endYm - startYm + 1;
  if (!(principal > 0) || months <= 0) return [];

  const r = annualRatePercent / 100 / 12;
  const payment =
    monthlyPaymentOverride && monthlyPaymentOverride > 0
      ? monthlyPaymentOverride
      : annuityMonthlyPayment(principal, annualRatePercent, months);

  const rows: AmortizationRow[] = [];
  let remaining = principal;
  for (let i = 0; i < months; i++) {
    const isLast = i === months - 1;
    const interest = Math.round(remaining * r);
    let principalPaid: number;
    let pay: number;
    if (isLast) {
      principalPaid = remaining;
      pay = principalPaid + interest;
    } else {
      pay = payment;
      principalPaid = Math.min(pay - interest, remaining);
    }
    remaining = Math.max(0, remaining - principalPaid);
    rows.push({
      ym: startYm + i,
      payment: Math.round(pay),
      principal: principalPaid,
      interest,
      remaining,
    });
  }
  return rows;
}

// 当初負債額を支払い開始月〜解消予定月で均等割りし、経過月数から現在残高を算出する。
// 支払いは開始月から毎月1回行われる想定。丸め誤差は最終月に吸収し、解消予定月を過ぎたら残高0。
export function computeDebtSchedule(
  initialAmount: number,
  startOn: Date,
  payoffDue: Date,
  now: Date = new Date(),
): DebtSchedule | null {
  const startYm = ymIndex(startOn);
  const payoffYm = ymIndex(payoffDue);
  const totalMonths = payoffYm - startYm + 1;
  if (!(initialAmount > 0) || totalMonths <= 0) return null;

  const monthly = Math.round(initialAmount / totalMonths);
  const nowYm = now.getFullYear() * 12 + now.getMonth();
  const paidMonths = Math.min(Math.max(nowYm - startYm + 1, 0), totalMonths);
  const remaining =
    paidMonths >= totalMonths ? 0 : Math.max(0, initialAmount - monthly * paidMonths);
  return { totalMonths, monthly, paidMonths, remaining };
}
