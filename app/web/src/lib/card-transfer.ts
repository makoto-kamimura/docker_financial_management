// カード明細の「チャージ（他カード・電子マネーへの資金移動）」判定。
//
// 三井住友カードの「[信] ＪＡＬ　Ｐａｙ」のようなチャージは、それ自体が支出ではなく
// チャージ先へ資金を移しているだけで、実際の支出はチャージ先の利用明細で計上される。
// 両方を科目に紐付けると同じ支出が二重に計上されるため、チャージ側は収支の対象外にする。
//
// 銀行明細の transferGroupId と同じ考え方だが、銀行は「出金と入金の 2 明細を対にする」のに対し
// カードは相手側に対応する行が無い（チャージ先の CSV には利用明細しか出てこない）。
// そのため対ではなく「チャージ先を指す 1 列」で表す。

import { normalizeKeyword } from "@/lib/banktxn-import";

export type CardTransferRuleInput = { keyword: string; transferToAccountId: number };

/**
 * 摘要にマッチするチャージ先の LinkedAccount ID をルールから決定する（取込時の自動判定）。
 * キーワードの長い順に評価し、最初に一致したものを採用する
 * （classifyByRules と同じ方針。より具体的なキーワードを優先する）。
 */
export function resolveTransferTarget(
  description: string,
  rules: CardTransferRuleInput[],
): number | null {
  const normalizedDesc = normalizeKeyword(description);
  const sorted = [...rules].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const rule of sorted) {
    if (normalizedDesc.includes(normalizeKeyword(rule.keyword))) {
      return rule.transferToAccountId;
    }
  }
  return null;
}

/** 一括操作・ルール適用の対象になりうる明細（転記済みは実績が既に立っているため対象外） */
export type MarkableCardTxn = {
  id: number;
  accountId: number;
  description: string;
  postedRecordId: number | null;
};

/**
 * チャージ指定の可否を判定する。問題があればその理由、無ければ null を返す。
 *
 * チャージ先を自分自身にすると資金がどこへ行ったのか表せないので弾く。
 * 転記済みは実績（FinancialRecord）が既に立っており、対象外にしても実績は消えないため、
 * 先に転記の取り消しが要る。
 */
export function validateCardTransferTarget(
  txn: MarkableCardTxn,
  transferToAccountId: number,
): string | null {
  if (txn.accountId === transferToAccountId) {
    return "チャージ先が同じカードです。別のカード・電子マネーを選択してください";
  }
  if (txn.postedRecordId !== null) {
    return "実績へ転記済みの明細はチャージにできません（先に転記を取り消してください）";
  }
  return null;
}
