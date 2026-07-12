export type DebtSchedule = {
  totalMonths: number; // 支払い回数（開始月〜解消予定月）
  monthly: number; // 月割り額（円・四捨五入）
  paidMonths: number; // 経過（支払い済み）回数
  remaining: number; // 現在の負債残高
};

export function ymIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
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
