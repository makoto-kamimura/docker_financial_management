// 銀行明細から「毎月の入出金」を見つけ、資金移動ルールの候補にする（資金繰りを登録済みの情報から割り出すため）。
//
// 口座ごと・入出金の向きと摘要（数字と空白を除いて正規化したもの）ごとに、直近 6 か月の明細をまとめ、
// 次をすべて満たすものを候補にする:
//   - 3 か月以上に出てくる（同じ月に複数あれば最初の 1 件）
//   - 金額が、中央値から ±10% に収まる
//   - 日付（日）が、中央値から ±3 日に収まる
//   - 先月か今月にも出てくる（止まった支払いを出さない）
// すでに近い資金移動ルール（同じ口座・向き、金額 ±10%、日 ±3 日）があるもの、非表示にしたものは出さない。

export type SuggestionTxn = { accountId: number; date: Date; description: string; amount: number };
export type SuggestionRule = {
  fromId: number | null;
  toId: number | null;
  amount: number;
  day: number;
};

export type RecurringCandidate = {
  accountId: number;
  /** 候補の見分け（非表示の記録に使う） */
  signature: string;
  direction: "in" | "out";
  /** いちばん新しい明細の摘要 */
  label: string;
  /** 金額（中央値・正の値） */
  amount: number;
  /** 日（中央値） */
  day: number;
  /** 出てきた月の数 */
  months: number;
  /** いちばん新しい明細の日付（YYYY-MM-DD） */
  lastDate: string;
};

const MIN_MONTHS = 3;
const AMOUNT_TOLERANCE = 0.1;
const DAY_TOLERANCE = 3;
const LOOKBACK_MONTHS = 6;

/** 摘要の正規化（全角半角をそろえ、数字・空白・記号を除く） */
export function normalizeDescription(description: string): string {
  return description
    .normalize("NFKC")
    .replace(/[0-9]/g, "")
    .replace(/[\s\-‐ー－_/\\.,:;()（）［］[\]・*#]/g, "")
    .toUpperCase();
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const ymd = (d: Date) => `${ymKey(d)}-${String(d.getDate()).padStart(2, "0")}`;

export const dismissKey = (accountId: number, signature: string) => `${accountId}:${signature}`;

export function findRecurringCandidates(
  txns: SuggestionTxn[],
  rules: SuggestionRule[],
  dismissed: Set<string>,
  today: Date = new Date(),
): RecurringCandidate[] {
  const since = new Date(today.getFullYear(), today.getMonth() - LOOKBACK_MONTHS, 1);
  const prevMonth = ymKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));

  // 口座 × 署名ごとに、月ごとの最初の明細を集める
  const groups = new Map<
    string,
    { accountId: number; signature: string; byMonth: Map<string, SuggestionTxn> }
  >();
  const sorted = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const t of sorted) {
    if (t.date < since || t.date > today || t.amount === 0) continue;
    const normalized = normalizeDescription(t.description);
    if (!normalized) continue;
    const signature = `${t.amount > 0 ? "in" : "out"}:${normalized}`;
    const key = dismissKey(t.accountId, signature);
    const g = groups.get(key) ?? { accountId: t.accountId, signature, byMonth: new Map() };
    const month = ymKey(t.date);
    if (!g.byMonth.has(month)) g.byMonth.set(month, t);
    groups.set(key, g);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [key, g] of groups) {
    if (dismissed.has(key)) continue;
    const items = [...g.byMonth.values()];
    if (items.length < MIN_MONTHS) continue;
    const last = items[items.length - 1];
    if (ymKey(last.date) < prevMonth) continue;

    const amounts = items.map((t) => Math.abs(t.amount));
    const days = items.map((t) => t.date.getDate());
    const amount = median(amounts);
    const day = Math.round(median(days));
    if (amounts.some((a) => Math.abs(a - amount) > amount * AMOUNT_TOLERANCE)) continue;
    if (days.some((d) => Math.abs(d - day) > DAY_TOLERANCE)) continue;

    const direction = last.amount > 0 ? "in" : "out";
    const covered = rules.some(
      (r) =>
        (direction === "out" ? r.fromId === g.accountId : r.toId === g.accountId) &&
        Math.abs(r.amount - amount) <= amount * AMOUNT_TOLERANCE &&
        Math.abs(r.day - day) <= DAY_TOLERANCE,
    );
    if (covered) continue;

    candidates.push({
      accountId: g.accountId,
      signature: g.signature,
      direction,
      label: last.description,
      amount: Math.round(amount),
      day,
      months: items.length,
      lastDate: ymd(last.date),
    });
  }
  return candidates.sort((a, b) => a.accountId - b.accountId || b.amount - a.amount);
}
