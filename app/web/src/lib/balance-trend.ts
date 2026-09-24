// 口座残高の推移（対象年月の前後 N か月）。銀行管理のサマリタブのグラフに使う純関数。
//
// 実績部分は明細の増減を月末まで累積した残高、将来部分は
// 「直近の実績残高 + 資金移動ルールの月次純増減 × 経過月数」で推測する。
// 残高の定義は口座サマリ（/api/bank-accounts の balance）と揃えてある。
//
// 月次（buildBalanceTrend）に加えて日次（buildDailyBalanceTrend）も用意している。
// 月次は月末残高しか見えないため、給与の入金前後のように月の途中で大きく上下する動きが
// 潰れてしまう。日次は同じ期間・同じ残高の定義のまま、その日ごとの変動を見せる。

export type BalanceTrendPoint = {
  /** "YYYY-MM" */
  month: string;
  /** 口座 id -> その月末の残高 */
  balances: Record<number, number>;
  /** true = 実績がまだ無く、資金移動ルールから推測した月 */
  estimated: boolean;
};

/** "YYYY-MM" 表記。月は 1〜12 で受け取る */
export function ym(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 起点の年月から offset か月ずらした "YYYY-MM" を返す（offset は負も可） */
export function shiftYm(year: number, month: number, offset: number): string {
  const base = new Date(Date.UTC(year, month - 1 + offset, 1));
  return ym(base.getUTCFullYear(), base.getUTCMonth() + 1);
}

/** 対象年月の前後を含む月の並び（昇順）。before/after はそれぞれの月数 */
export function trendMonths(year: number, month: number, before: number, after: number): string[] {
  const months: string[] = [];
  for (let i = -before; i <= after; i++) months.push(shiftYm(year, month, i));
  return months;
}

export function buildBalanceTrend(input: {
  accountIds: number[];
  /** 口座 id -> "YYYY-MM" -> その月の増減合計（実績） */
  monthlyNet: Map<number, Map<string, number>>;
  /** 口座 id -> 資金移動ルールから求めた 1 か月あたりの純増減（推測に使う） */
  recurringNet: Map<number, number>;
  /** 表示する月（昇順） */
  months: string[];
  /** この月までは実績として扱い、これより後を推測にする（"YYYY-MM"） */
  actualThroughMonth: string;
  /**
   * 口座 id -> 明細に現れない差額（BankAccount.balanceAdjustment）。
   * 期首残高相当の定数オフセットなので全ての月に一律で足す（lib/bank-balance.ts と同じ定義）。
   */
  adjustments?: Map<number, number>;
}): BalanceTrendPoint[] {
  const { accountIds, monthlyNet, recurringNet, months, actualThroughMonth, adjustments } = input;

  // 実績の月末残高。月は "YYYY-MM" の辞書順が時系列順と一致するため文字列比較で足し込める。
  const actualBalanceAt = (accountId: number, month: string) => {
    let sum = adjustments?.get(accountId) ?? 0;
    for (const [m, net] of monthlyNet.get(accountId) ?? []) {
      if (m <= month) sum += net;
    }
    return sum;
  };

  // 推測の起点は「実績として扱う最終月」の残高。ここから月次の純増減を積み上げる。
  const baseBalance = new Map(
    accountIds.map((id) => [id, actualBalanceAt(id, actualThroughMonth)]),
  );

  // 推測月が起点から何か月先かを数える（months は連続した月なので並びから求める）
  const monthsAhead = (month: string) => {
    const [by, bm] = actualThroughMonth.split("-").map(Number);
    const [ty, tm] = month.split("-").map(Number);
    return (ty - by) * 12 + (tm - bm);
  };

  return months.map((month) => {
    const estimated = month > actualThroughMonth;
    const balances: Record<number, number> = {};
    for (const id of accountIds) {
      balances[id] = estimated
        ? (baseBalance.get(id) ?? 0) + (recurringNet.get(id) ?? 0) * monthsAhead(month)
        : actualBalanceAt(id, month);
    }
    return { month, balances, estimated };
  });
}

// ─── 日次 ────────────────────────────────────────────────────────────────────

export type DailyBalanceTrendPoint = {
  /** "YYYY-MM-DD" */
  date: string;
  /** 口座 id -> その日の終わりの残高 */
  balances: Record<number, number>;
  /** true = 実績がまだ無く、資金移動ルールから推測した日 */
  estimated: boolean;
};

/** 資金移動ルール（毎月 day 日に amount を from → to へ動かす） */
export type RecurringTransfer = {
  fromId: number | null;
  toId: number | null;
  amount: number;
  day: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" 表記 */
export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const daysInMonth = (year: number, month1to12: number) =>
  new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

/** "YYYY-MM-DD" の翌日 */
export function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * 対象年月の前後を含む日付の並び（昇順）。
 * 月次の trendMonths と同じ期間で、開始月の 1 日から終了月の末日までを 1 日刻みで返す。
 */
export function trendDates(year: number, month: number, before: number, after: number): string[] {
  const start = new Date(Date.UTC(year, month - 1 - before, 1));
  const endExclusive = new Date(Date.UTC(year, month - 1 + after + 1, 1));
  const dates: string[] = [];
  for (
    const cursor = new Date(start);
    cursor < endExclusive;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(ymd(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()));
  }
  return dates;
}

/**
 * 日次の残高推移。
 *
 * actualThroughDate（通常は今日）までは明細の増減を積み上げた実績、それより後は
 * 実績最終日の残高を起点に資金移動ルールを予定日ごとに適用した推測を返す。
 * 月次と同じく、窓の開始より前の明細も残高に含める（期首からの累積）。
 */
export function buildDailyBalanceTrend(input: {
  accountIds: number[];
  /** 口座 id -> "YYYY-MM-DD" -> その日の増減合計（実績） */
  dailyNet: Map<number, Map<string, number>>;
  /** 資金移動ルール。推測部分でのみ使う */
  recurring: RecurringTransfer[];
  /** 表示する日（昇順・連続した "YYYY-MM-DD"） */
  dates: string[];
  /** この日までは実績として扱い、これより後を推測にする（"YYYY-MM-DD"） */
  actualThroughDate: string;
  /** 口座 id -> 明細に現れない差額（期首残高相当。全ての日に一律で足す） */
  adjustments?: Map<number, number>;
}): DailyBalanceTrendPoint[] {
  const { accountIds, dailyNet, recurring, dates, actualThroughDate, adjustments } = input;
  if (dates.length === 0) return [];

  // 実績の累積残高。日付は "YYYY-MM-DD" の辞書順が時系列順と一致するため文字列比較で足せる
  const actualBalanceAt = (accountId: number, date: string) => {
    let sum = adjustments?.get(accountId) ?? 0;
    for (const [d, net] of dailyNet.get(accountId) ?? []) {
      if (d <= date) sum += net;
    }
    return sum;
  };

  // 推測の起点は実績最終日の残高。そこから 1 日ずつ資金移動ルールを適用して積み上げる。
  // 窓が実績最終日よりずっと先から始まることもあるので、起点の翌日から窓の終わりまで通して進める。
  const projected = new Map(accountIds.map((id) => [id, actualBalanceAt(id, actualThroughDate)]));
  const lastDate = dates[dates.length - 1];
  const wanted = new Set(dates);
  const projectedByDate = new Map<string, Record<number, number>>();

  for (let cursor = nextDate(actualThroughDate); cursor <= lastDate; cursor = nextDate(cursor)) {
    const [y, m, d] = cursor.split("-").map(Number);
    const dim = daysInMonth(y, m);
    for (const t of recurring) {
      // 指定日が月末を超える場合は月末日に実行する（lib/funding-plan.ts と同じ扱い）
      if (d !== Math.min(t.day, dim)) continue;
      const amount = Math.abs(t.amount);
      if (t.fromId !== null && projected.has(t.fromId)) {
        projected.set(t.fromId, (projected.get(t.fromId) ?? 0) - amount);
      }
      if (t.toId !== null && projected.has(t.toId)) {
        projected.set(t.toId, (projected.get(t.toId) ?? 0) + amount);
      }
    }
    if (wanted.has(cursor)) {
      projectedByDate.set(
        cursor,
        Object.fromEntries(accountIds.map((id) => [id, projected.get(id) ?? 0])),
      );
    }
  }

  return dates.map((date) => {
    const estimated = date > actualThroughDate;
    const balances: Record<number, number> = estimated
      ? (projectedByDate.get(date) ?? {})
      : Object.fromEntries(accountIds.map((id) => [id, actualBalanceAt(id, date)]));
    return { date, balances, estimated };
  });
}
