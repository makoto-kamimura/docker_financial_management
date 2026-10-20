// 銀行明細の「カード代金の引き落とし」（クレジットカードの利用分の引き落とし）。
//
// カード代金の引き落としは、それ自体が支出ではなく、カードの利用明細の支払いをまとめたもの。
// 中身はカードの利用明細で数えるので、銀行側にも科目を付けると同じ支出が二重に計上される。
// そのため銀行側は科目を付けず、引き落とし先のカードを chargeToCardId に入れて実績から外す
// （チャージと同じ列。チャージ先がクレジットカードならカード代金として扱う）。
// カードの CSV には代金の入金が出てこないことが多いので、チャージと違って対の明細は持たない。
//
// 前にカード代金にした明細と同じ口座・同じ摘要の出金は、同じカードの代金とみなす（取り込み・まとめて自動処理）。

import { normalizeKeyword } from "@/lib/ledger/banktxn-import";
import { SETTLEMENT_CARD_TYPE } from "@/lib/shared/linked-account-type";
import type { TenantDbClient } from "@/lib/server/tenant-db";

export type SettlementSample = {
  bankAccountId: number | null;
  description: string | null;
  chargeToCardId: number | null;
};

/** 口座と摘要から、カード代金の引き落とし先のカードを引く。当たらなければ null */
export type SettlementLookup = (
  bankAccountId: number | null,
  description: string | null,
  flow: number,
) => number | null;

const keyOf = (bankAccountId: number | null, description: string | null) =>
  `${bankAccountId ?? ""}\u0000${normalizeKeyword(description ?? "")}`;

/**
 * カード代金にした明細から「口座 + 摘要 → カード」の対応表を作る。
 * 同じ口座・同じ摘要が別々のカードに分かれていれば、どちらとも決められないので使わない。
 * 入金や空の摘要には当てない。
 */
export function buildSettlementLookup(samples: SettlementSample[]): SettlementLookup {
  const map = new Map<string, number | null>();
  for (const s of samples) {
    if (s.chargeToCardId === null || !normalizeKeyword(s.description ?? "")) continue;
    const key = keyOf(s.bankAccountId, s.description);
    const seen = map.get(key);
    if (seen === undefined) map.set(key, s.chargeToCardId);
    else if (seen !== s.chargeToCardId) map.set(key, null);
  }
  return (bankAccountId, description, flow) => {
    if (flow >= 0 || !normalizeKeyword(description ?? "")) return null;
    return map.get(keyOf(bankAccountId, description)) ?? null;
  };
}

/** これまでにカード代金にした銀行明細から対応表を作る（bankAccountId を渡せばその口座だけ） */
export async function loadSettlementLookup(
  db: Pick<TenantDbClient, "financialRecord">,
  bankAccountId?: number,
): Promise<SettlementLookup> {
  const samples = await db.financialRecord.findMany({
    where: {
      kind: "BANK",
      ...(bankAccountId === undefined ? {} : { bankAccountId }),
      chargeToCard: { type: SETTLEMENT_CARD_TYPE },
    },
    select: { bankAccountId: true, description: true, chargeToCardId: true },
  });
  return buildSettlementLookup(samples);
}
