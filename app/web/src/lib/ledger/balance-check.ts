// 銀行の明細の CSV の残高の照合（純関数）。取り込む前の確認に出し、取り込みは止めない。
//   - 行のつながり: 前の行の残高 + 金額 = その行の残高。合わなければ、間の行が欠けているおそれがある
//   - 始まり: CSV の最初の行の直前の残高（残高 − 金額）と、アプリのその日より前の残高を比べる
// 日付が降順のファイル（新しい明細が上）は、古い順に並べ直して見る。残高の無い行が 1 つでもあれば照合しない。

export type BalanceRow = { date: string; amount: number; balance?: number | null };

export type BalanceGap = {
  /** 渡した行の位置（0 始まり） */
  index: number;
  date: string;
  /** 前の行の残高 + 金額 */
  expected: number;
  /** CSV の残高 */
  actual: number;
};

/** 照合に出す行のつながりの切れ目の数の上限 */
const MAX_GAPS = 5;

/** 古い順に並べた行の位置。最初の日付が最後の日付より新しければ、ファイルは降順とみなして逆にする */
function chronological(rows: BalanceRow[]): number[] {
  const indexes = rows.map((_, i) => i);
  return rows.length > 1 && rows[0].date > rows[rows.length - 1].date ? indexes.reverse() : indexes;
}

const yen = (n: number) => Math.round(n);

/**
 * 残高の列から、行のつながりの切れ目と、最初の行の直前の残高を求める。残高の無い行があれば null。
 */
export function checkStatementBalances(rows: BalanceRow[]): {
  gaps: BalanceGap[];
  opening: { date: string; balance: number };
} | null {
  if (rows.length === 0 || rows.some((r) => r.balance === undefined || r.balance === null)) {
    return null;
  }
  const order = chronological(rows);
  const gaps: BalanceGap[] = [];
  for (let k = 1; k < order.length && gaps.length < MAX_GAPS; k++) {
    const prev = rows[order[k - 1]];
    const cur = rows[order[k]];
    const expected = yen(prev.balance! + cur.amount);
    if (expected !== yen(cur.balance!)) {
      gaps.push({ index: order[k], date: cur.date, expected, actual: yen(cur.balance!) });
    }
  }
  const first = rows[order[0]];
  return { gaps, opening: { date: first.date, balance: yen(first.balance! - first.amount) } };
}
