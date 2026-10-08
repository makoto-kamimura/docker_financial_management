// チャージ（銀行口座・カード → デビット / プリペイド / 電子マネー）の
// 「チャージ元の明細」と「チャージ先に入った明細」を対にするための突き合わせ。
//
// これまでチャージは元の明細にチャージ先（LinkedAccount）を持たせるだけで、チャージ先の
// 記録とは結び付いていなかった。チャージ先の CSV に入金行が含まれる場合、どの入金がどの
// チャージなのかが分からず、入金行を科目に紐付けて収入として二重計上する余地が残る。
//
// そこでチャージ先の明細を人が 1 件選んで対にする。機械的に確定させず候補の並べ替えだけを
// 行うのは、チャージ先の摘要が「チャージ」「入金」などカードごとにまちまちで、金額と日付しか手掛かりが無いため。

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

/** チャージ先の候補となる明細（カードの符号: +利用（支出） / -返金・入金。明細の表の金額は cardSpend で直して渡す） */
export type ChargeCandidateTxn = {
  id: number;
  date: Date;
  description: string;
  amount: number;
  categoryAccountId: number | null;
};

export type RankedChargeCandidate<T extends ChargeCandidateTxn = ChargeCandidateTxn> = {
  txn: T;
  /** チャージ日とのずれ（暦日） */
  dayGap: number;
  /** 金額（絶対値）が一致するか */
  amountMatch: boolean;
  /** チャージ先から見て入金（残高が増える）方向か */
  incoming: boolean;
};

/** 日付のずれの既定の許容値。チャージは即時反映が多いが、締めの都合で数日ずれることがある */
export const DEFAULT_CHARGE_DAY_GAP = 7;

/**
 * チャージ先の明細を「そのチャージらしい順」に並べ替える。
 *
 * 並び順は 金額一致かつ入金 → 金額一致 → 入金 → その他 の優先度で、同じ優先度なら
 * 日付のずれが小さい順、さらに同じなら新しい順。maxDayGap を超える明細は落とす。
 *
 * 絞り込まずに順序だけ付けるのは、金額がぴったり一致しないチャージ（手数料込み・
 * ポイント併用など）も人が見て選べるようにするため。
 */
export function rankChargeCandidates<T extends ChargeCandidateTxn>(
  txns: T[],
  charge: { amount: number; date: Date },
  opts: { maxDayGap?: number } = {},
): RankedChargeCandidate<T>[] {
  const maxDayGap = opts.maxDayGap ?? DEFAULT_CHARGE_DAY_GAP;
  const chargeAmount = Math.abs(charge.amount);

  return txns
    .map((txn) => ({
      txn,
      dayGap: dayGap(txn.date, charge.date),
      amountMatch: Math.abs(Math.abs(txn.amount) - chargeAmount) < 0.005,
      // カード台帳は「+利用（支出） / -返金・入金」なので、チャージによる入金は負で入る
      incoming: txn.amount < 0,
    }))
    .filter((c) => c.dayGap <= maxDayGap)
    .sort(
      (a, b) =>
        rank(a) - rank(b) || a.dayGap - b.dayGap || b.txn.date.getTime() - a.txn.date.getTime(),
    );
}

function rank(c: { amountMatch: boolean; incoming: boolean }): number {
  if (c.amountMatch && c.incoming) return 0;
  if (c.amountMatch) return 1;
  if (c.incoming) return 2;
  return 3;
}

/** 対にする相手として選ばれたチャージ先の明細 */
export type LinkableChargeTxn = {
  id: number;
  accountId: number;
  chargeGroupId: string | null;
  /** その明細自身がさらに別のカードへのチャージになっている場合のチャージ先 */
  transferToAccountId: number | null;
};

/**
 * チャージ先の明細を対にしてよいか判定する。問題があればその理由、無ければ null を返す。
 *
 * 既に別のチャージと対になっている明細は選べない（1 つの入金が複数のチャージの相手になることはない）。
 * 科目が付いていた明細は、対にすると科目が外れて実績から抜ける（呼び出し側で外す）。
 */
export function validateChargePair(txn: LinkableChargeTxn, targetAccountId: number): string | null {
  if (txn.accountId !== targetAccountId) {
    return "選択した明細はチャージ先のカード・電子マネーのものではありません";
  }
  if (txn.chargeGroupId !== null) {
    return "この明細は既に別のチャージと紐付けられています";
  }
  if (txn.transferToAccountId !== null) {
    return "この明細は別のカードへのチャージとして指定されています";
  }
  return null;
}
