// 銀行管理の残高の推移（純関数）。
//
// 口座ごと: 今月までは明細から出した月末残高（明細の合計 + 差額。lib/bank-balance.ts と同じ定義）、
//   先は資金移動ルール（借入の返済の自動の引き落としも含む）の月の収支を積み上げる。資金繰りと同じ考え方。
// 合計: 今月より前は口座ごとの残高の合計。今月と先は予算と実績につなげて見込む。
//   - 今月 … 今日の残高 + （今月の予算の収支 − 今月これまでの実績の収支）
//   - 先の月 … 前の月の残高 + その月の予算の収支。予算の無い月は資金移動ルールの月の収支で代わりにする
//   予算・実績の収支は「収入 − 原価 − 費用」（家計では貯蓄額。/api/kpi と同じ区分）。

export type OutlookRule = {
  fromId: number | null;
  toId: number | null;
  amount: number;
  /** この月（"YYYY-MM"）から有効。無ければ期限なし */
  activeFrom?: string;
  /** この月（"YYYY-MM"）まで有効。無ければ期限なし */
  activeUntil?: string;
};

/** 見込みの出どころ（actual = 明細の実績、budget = 予算、rule = 資金移動ルール） */
export type OutlookBasis = "actual" | "budget" | "rule";

export type CashOutlook = {
  /** 口座 id -> 月ごとの残高（months と同じ並び） */
  accounts: Map<number, number[]>;
  /** 月ごとの合計残高 */
  total: number[];
  totalBasis: OutlookBasis[];
};

const isActive = (r: OutlookRule, month: string) =>
  (!r.activeFrom || r.activeFrom <= month) && (!r.activeUntil || month <= r.activeUntil);

/** 資金移動ルールから求めた、その月の口座の収支（入金は正、出金は負） */
export function ruleNetOf(rules: OutlookRule[], accountId: number, month: string): number {
  let net = 0;
  for (const r of rules) {
    if (!isActive(r, month)) continue;
    const amount = Math.abs(r.amount);
    if (r.fromId === accountId) net -= amount;
    if (r.toId === accountId) net += amount;
  }
  return net;
}

export function buildCashOutlook(input: {
  accountIds: number[];
  /** 口座 id -> "YYYY-MM" -> その月の明細の増減合計 */
  monthlyNet: Map<number, Map<string, number>>;
  /** 口座 id -> 差額（BankAccount.balanceAdjustment） */
  adjustments: Map<number, number>;
  rules: OutlookRule[];
  /** 表示する月（昇順・連続） */
  months: string[];
  /** 今月（"YYYY-MM"）。ここまでを実績にする */
  currentKey: string;
  /** "YYYY-MM" -> 予算の収支（予算のある月だけ） */
  budgetNet: Map<string, number>;
  /** "YYYY-MM" -> 実績の収支（実績のある月だけ） */
  actualNet: Map<string, number>;
}): CashOutlook {
  const { accountIds, monthlyNet, adjustments, rules, months, currentKey, budgetNet, actualNet } =
    input;

  const actualBalanceAt = (id: number, month: string) => {
    let sum = adjustments.get(id) ?? 0;
    for (const [m, net] of monthlyNet.get(id) ?? []) if (m <= month) sum += net;
    return sum;
  };

  // 口座ごと: 今月までは実績、先はルールの収支を積み上げる
  const accounts = new Map<number, number[]>();
  for (const id of accountIds) {
    const values: number[] = [];
    let prev = actualBalanceAt(id, currentKey);
    for (const month of months) {
      if (month <= currentKey) {
        values.push(actualBalanceAt(id, month));
      } else {
        prev += ruleNetOf(rules, id, month);
        values.push(prev);
      }
    }
    accounts.set(id, values);
  }

  // 合計: 今月より前は実績の合計、今月と先は予算と実績から
  const total: number[] = [];
  const totalBasis: OutlookBasis[] = [];
  const todayTotal = accountIds.reduce((s, id) => s + actualBalanceAt(id, currentKey), 0);
  let prev = todayTotal;
  months.forEach((month, i) => {
    if (month < currentKey) {
      total.push(accountIds.reduce((s, id) => s + accounts.get(id)![i], 0));
      totalBasis.push("actual");
    } else if (month === currentKey) {
      const budget = budgetNet.get(month);
      // 今月の残り = 予算の収支 − これまでの実績の収支（予算が無ければ今日の残高のまま）
      prev = budget === undefined ? todayTotal : todayTotal + budget - (actualNet.get(month) ?? 0);
      total.push(prev);
      totalBasis.push(budget === undefined ? "actual" : "budget");
    } else {
      const budget = budgetNet.get(month);
      if (budget !== undefined) {
        prev += budget;
        totalBasis.push("budget");
      } else {
        prev += accountIds.reduce((s, id) => s + ruleNetOf(rules, id, month), 0);
        totalBasis.push("rule");
      }
      total.push(prev);
    }
  });

  return { accounts, total, totalBasis };
}
