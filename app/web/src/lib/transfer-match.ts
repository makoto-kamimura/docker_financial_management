// 取込済みの明細どうしを後付けで「振替」として紐付けるための候補抽出（案 C）。
//
// CSV を口座ごとに取り込むと、1 回の資金移動が「出金元の −金額」と「入金先の +金額」の
// 2 明細として別々に入る。これを transferGroupId で対にしておかないと、どちらも収入・支出として
// 科目に紐付けられてしまい二重計上になる（POST /api/bank-transfers の登録フローでは
// 最初から対で作るのでこの問題は起きないが、両口座の CSV を後から取り込むと起きる）。
//
// ここでは「同額・符号が逆・別口座・日付が近い」明細の組を候補として拾う。突き合わせは
// 機械的な推測にすぎないので、実際に紐付けるかどうかは画面で 1 組ずつ人が確認する。

/** 突き合わせ対象の明細（transferGroupId が未設定で、実績へ未転記のものだけを渡す） */
export type MatchableTxn = {
  id: number;
  accountId: number;
  date: Date;
  description: string;
  /** +入金 / −出金 */
  amount: number;
};

export type TransferMatch<T extends MatchableTxn = MatchableTxn> = {
  /** 出金側（amount < 0） */
  outTxn: T;
  /** 入金側（amount > 0） */
  inTxn: T;
  /** 振替額（正の数） */
  amount: number;
  /** 出金日と入金日のずれ（暦日） */
  dayGap: number;
};

/** 日付のずれの既定の許容値。他行宛の振込は着金が翌営業日になることがあるため 0 では狭い */
export const DEFAULT_MAX_DAY_GAP = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 2 つの日付の暦日単位のずれ。明細の日付は UTC 0 時で保持しているため UTC で切り出す
 * （lib/balance-trend.ts と同じ扱い）。
 */
export function dayGap(a: Date, b: Date): number {
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round(Math.abs(da - db) / DAY_MS);
}

/**
 * 振替候補の組を抽出する。
 *
 * 条件は「金額の絶対値が一致」「符号が逆」「別口座」「日付のずれが maxDayGap 以内」。
 * 1 つの明細が複数の組に現れないよう、日付のずれが小さい組から順に確定させる
 * （同額の振込が近い日に複数あるとき、一番近いものどうしを対にするのが自然なため）。
 *
 * 返り値は出金日の新しい順。
 */
export function findTransferMatches<T extends MatchableTxn>(
  txns: T[],
  opts: { maxDayGap?: number } = {},
): TransferMatch<T>[] {
  const maxDayGap = opts.maxDayGap ?? DEFAULT_MAX_DAY_GAP;

  // 金額の絶対値で束ねてから突き合わせる（全組み合わせを見ずに済む）
  const insByAmount = new Map<number, T[]>();
  for (const t of txns) {
    if (t.amount <= 0) continue;
    const key = Math.abs(t.amount);
    const bucket = insByAmount.get(key);
    if (bucket) bucket.push(t);
    else insByAmount.set(key, [t]);
  }

  const candidates: TransferMatch<T>[] = [];
  for (const outTxn of txns) {
    if (outTxn.amount >= 0) continue;
    const amount = Math.abs(outTxn.amount);
    for (const inTxn of insByAmount.get(amount) ?? []) {
      if (inTxn.accountId === outTxn.accountId) continue;
      const gap = dayGap(outTxn.date, inTxn.date);
      if (gap > maxDayGap) continue;
      candidates.push({ outTxn, inTxn, amount, dayGap: gap });
    }
  }

  // ずれが小さい順 → 出金日が新しい順 → id 順（同着の並びを決定的にする）
  candidates.sort(
    (a, b) =>
      a.dayGap - b.dayGap ||
      b.outTxn.date.getTime() - a.outTxn.date.getTime() ||
      a.outTxn.id - b.outTxn.id ||
      a.inTxn.id - b.inTxn.id,
  );

  const used = new Set<number>();
  const matches: TransferMatch<T>[] = [];
  for (const c of candidates) {
    if (used.has(c.outTxn.id) || used.has(c.inTxn.id)) continue;
    used.add(c.outTxn.id);
    used.add(c.inTxn.id);
    matches.push(c);
  }

  matches.sort(
    (a, b) =>
      b.outTxn.date.getTime() - a.outTxn.date.getTime() ||
      b.amount - a.amount ||
      a.outTxn.id - b.outTxn.id,
  );
  return matches;
}

/** 紐付け可否の判定に必要な最小限の情報 */
export type LinkableTxn = {
  id: number;
  accountId: number;
  amount: number;
  transferGroupId: string | null;
  postedRecordId: number | null;
  /** カード・電子マネーへのチャージとして指定済みなら、その相手（口座間振替にはできない） */
  chargeToAccountId?: number | null;
};

/**
 * 2 明細を振替として紐付けてよいか検証する。問題があればその理由、無ければ null を返す。
 *
 * 候補抽出と違い日付のずれは見ない（候補に出なかった組を人が選ぶ余地を残すため）。
 * 一方で金額・符号・口座・状態の条件は、崩れると残高や収支が合わなくなるので必ず確かめる。
 */
export function validateTransferLink(a: LinkableTxn, b: LinkableTxn): string | null {
  if (a.id === b.id) return "同じ明細どうしは紐付けできません";
  if (a.accountId === b.accountId) return "同じ口座の明細どうしは振替になりません";
  if (a.transferGroupId || b.transferGroupId) return "すでに振替として紐付けられている明細です";
  if (a.chargeToAccountId || b.chargeToAccountId) {
    return "カード・電子マネーへのチャージとして指定済みの明細です（先にチャージを解除してください）";
  }
  if (a.postedRecordId !== null || b.postedRecordId !== null) {
    return "実績へ転記済みの明細は紐付けできません（先に転記を取り消してください）";
  }

  const hasOut = a.amount < 0 || b.amount < 0;
  const hasIn = a.amount > 0 || b.amount > 0;
  if (!hasOut || !hasIn) return "出金（マイナス）と入金（プラス）の組で指定してください";
  if (Math.abs(a.amount) !== Math.abs(b.amount)) {
    return "金額が一致しません（振替は同額の出金と入金の組で紐付けます）";
  }
  return null;
}
