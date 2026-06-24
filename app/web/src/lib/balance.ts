// 口座残高シミュレーション。
// 期首残高と、毎月決まった日に実行される資金移動（振込/引き落とし）から、
// 日次の残高推移を計算し、残高不足が発生する日を検出する。

export type SimAccount = { id: number; name: string; opening: number };
// fromId/toId は口座(number)または外部(null)。
// 入金: fromId=null, 支出/引き落とし: toId=null, 口座間振替: 両方指定。
export type SimTransfer = { fromId: number | null; toId: number | null; amount: number; day: number };

export type BalancePoint = { date: string; balances: Record<number, number> };
export type Shortfall = { date: string; accountId: number; accountName: string; balance: number };

export type SimulationResult = {
  timeline: BalancePoint[];
  shortfalls: Shortfall[];
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daysInMonth = (year: number, month1to12: number) => new Date(year, month1to12, 0).getDate();

// 指定期間（startYear/startMonth から months か月）を日次でシミュレートする。
export function simulateBalances(
  accounts: SimAccount[],
  transfers: SimTransfer[],
  opts: { startYear: number; startMonth: number; months: number },
): SimulationResult {
  const balances: Record<number, number> = {};
  for (const a of accounts) balances[a.id] = a.opening;
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));

  const timeline: BalancePoint[] = [];
  const shortfalls: Shortfall[] = [];

  const start = new Date(opts.startYear, opts.startMonth - 1, 1);
  const cursor = new Date(start);
  const end = new Date(opts.startYear, opts.startMonth - 1 + opts.months, 1);

  while (cursor < end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    const dim = daysInMonth(y, m);

    // この日に実行される資金移動を適用（指定日が月末を超える場合は月末日に実行）
    for (const t of transfers) {
      const effectiveDay = Math.min(t.day, dim);
      if (d === effectiveDay) {
        if (t.fromId != null && balances[t.fromId] !== undefined) balances[t.fromId] -= t.amount;
        if (t.toId != null && balances[t.toId] !== undefined) balances[t.toId] += t.amount;
      }
    }

    const snapshot: Record<number, number> = {};
    for (const a of accounts) {
      snapshot[a.id] = balances[a.id];
      if (balances[a.id] < 0) {
        shortfalls.push({
          date: ymd(cursor),
          accountId: a.id,
          accountName: nameById.get(a.id) ?? String(a.id),
          balance: balances[a.id],
        });
      }
    }
    timeline.push({ date: ymd(cursor), balances: snapshot });

    cursor.setDate(cursor.getDate() + 1);
  }

  return { timeline, shortfalls };
}
