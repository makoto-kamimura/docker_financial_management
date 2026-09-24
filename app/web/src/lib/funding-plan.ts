// 資金繰り計画（必要残高と入金期限の算出）。
//
// 「毎月◯日に引き落とし」という資金移動ルールと各口座の現在残高から、
// 先々の入出金を時系列に並べ、残高がマイナスになる（＝引き落とし不能になる）
// タイミングと、それを避けるために必要な追加入金額・入金期限を求める。
// 残高シミュレーションの「実行ボタンで試算する」形をやめ、この結果を常時表示する。

export type FundingAccount = { id: number; name: string; opening: number };

// 資金移動ルール。fromId/toId は口座(number)または外部(null)。
export type FundingTransfer = {
  fromId: number | null;
  toId: number | null;
  amount: number;
  day: number;
  /** 表示用のラベル（未設定なら種別名などを呼び出し側で入れる） */
  label: string | null;
};

export type FundingEvent = {
  date: string; // YYYY-MM-DD
  label: string;
  /** 入金は正、出金は負 */
  amount: number;
  /** このイベント適用後の残高 */
  balanceAfter: number;
};

export type FundingPlan = {
  accountId: number;
  accountName: string;
  /** 起点残高（現在残高） */
  opening: number;
  /** 期間内の最終残高 */
  closing: number;
  /** 期間内の最小残高とその日付 */
  minBalance: number;
  minBalanceDate: string | null;
  /** 不足を避けるために必要な追加入金額（不足しなければ 0） */
  requiredDeposit: number;
  /** 追加入金の期限（最初に残高がマイナスになる引き落とし日。この日までの入金が必要） */
  deadline: string | null;
  /** 期限を決めた引き落とし（不足の引き金になったイベント） */
  trigger: FundingEvent | null;
  /** 期間内の入出金イベント（フロー表示用） */
  events: FundingEvent[];
};

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const daysInMonth = (year: number, month1to12: number) => new Date(year, month1to12, 0).getDate();

// 口座ごとに、開始年月から months か月分の入出金イベントと不足判定を組み立てる。
// 同じ日に入出金が重なる場合は出金を先に適用する（引き落とし時点で足りているかを厳しく見る）。
export function computeFundingPlans(
  accounts: FundingAccount[],
  transfers: FundingTransfer[],
  opts: { startYear: number; startMonth: number; months: number },
): FundingPlan[] {
  return accounts.map((a) => {
    const events: FundingEvent[] = [];
    let balance = a.opening;
    let minBalance = a.opening;
    let minBalanceDate: string | null = null;
    let trigger: FundingEvent | null = null;

    for (let i = 0; i < opts.months; i++) {
      const base = new Date(opts.startYear, opts.startMonth - 1 + i, 1);
      const y = base.getFullYear();
      const m = base.getMonth() + 1;
      const dim = daysInMonth(y, m);

      const monthly = transfers
        .filter((t) => t.fromId === a.id || t.toId === a.id)
        .map((t) => {
          const isOut = t.fromId === a.id;
          return {
            // 指定日が月末を超える場合は月末日に実行する（balance.ts と同じ扱い）
            day: Math.min(t.day, dim),
            amount: isOut ? -Math.abs(t.amount) : Math.abs(t.amount),
            label: t.label ?? (isOut ? "出金" : "入金"),
          };
        })
        // 同日は出金（負の金額）を先に
        .sort((x, z) => x.day - z.day || x.amount - z.amount);

      for (const e of monthly) {
        balance += e.amount;
        const ev: FundingEvent = {
          date: ymd(y, m, e.day),
          label: e.label,
          amount: e.amount,
          balanceAfter: balance,
        };
        events.push(ev);
        if (balance < minBalance) {
          minBalance = balance;
          minBalanceDate = ev.date;
        }
        if (trigger === null && balance < 0) trigger = ev;
      }
    }

    return {
      accountId: a.id,
      accountName: a.name,
      opening: a.opening,
      closing: balance,
      minBalance,
      minBalanceDate,
      requiredDeposit: minBalance < 0 ? Math.abs(minBalance) : 0,
      deadline: trigger?.date ?? null,
      trigger,
      events,
    };
  });
}
