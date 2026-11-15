// 明細分け（通販の注文）の請求と、カード・銀行の明細の紐付けの判定（DB を使わない純関数）。
// DB の読み書きは lib/ledger/shop-link.ts。
//
// 自動で紐付けるのは、次をすべて満たし、請求と明細が互いに 1 つに決まるときだけ:
//   - 明細が出金で、金額が請求額とぴったり同じ
//   - 明細の日付が請求日の 3 日前から 10 日後まで（カードの計上は請求より遅れることがある）
//   - 摘要が明細分けのキーワードに当たり、除外に当たらない
//   - 支払いに使うカード・口座を選んでいれば、その明細
// 互いに区別の付かない明細（同じ日・同じ金額・同じカード）に、同じ候補を持つ請求が同じ数だけあるときは、
// どれと組んでも同じなので、id の小さい順に組む（lib/ledger/auto-offset.ts と同じ考え方）。

import { matchesShopDescription } from "@/lib/shared/shop-account-type";

/** 自動で紐付ける、請求日から見た明細の日付の範囲（日） */
export const LINK_DAYS_BEFORE = 3;
export const LINK_DAYS_AFTER = 10;

export type LinkCharge = {
  id: number;
  shopAccountId: number;
  /** 請求日（YYYY-MM-DD） */
  ymd: string;
  /** 請求額（正） */
  amount: number;
};

export type LinkEntry = {
  id: number;
  kind: "CASH" | "BANK" | "CARD";
  /** 銀行は口座 id、カードはカード id、現金は null */
  sourceId: number | null;
  ymd: string;
  /** +入金 / −出金 */
  flow: number;
  description: string;
};

export type LinkShop = {
  id: number;
  type: string;
  matchKeywords: string[];
  excludeKeywords: string[];
  paymentCardIds: number[];
  paymentBankIds: number[];
};

const DAY_MS = 86_400_000;
const ymdTime = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/** 明細の日付 − 請求日（日） */
export function dayGap(entryYmd: string, chargeYmd: string): number {
  return Math.round((ymdTime(entryYmd) - ymdTime(chargeYmd)) / DAY_MS);
}

const yen = (n: number) => Math.round(n);

/** 支払いに使うカード・口座の絞り込みに当たるか（選んでいなければすべて） */
function paidFrom(shop: LinkShop, e: LinkEntry): boolean {
  if (shop.paymentCardIds.length === 0 && shop.paymentBankIds.length === 0) return true;
  if (e.kind === "CARD") return e.sourceId !== null && shop.paymentCardIds.includes(e.sourceId);
  if (e.kind === "BANK") return e.sourceId !== null && shop.paymentBankIds.includes(e.sourceId);
  return false;
}

/** 自動で紐付けてよい組か */
export function isAutoLinkable(charge: LinkCharge, entry: LinkEntry, shop: LinkShop): boolean {
  if (entry.flow >= 0 || yen(-entry.flow) !== yen(charge.amount)) return false;
  const gap = dayGap(entry.ymd, charge.ymd);
  if (gap < -LINK_DAYS_BEFORE || gap > LINK_DAYS_AFTER) return false;
  return paidFrom(shop, entry) && matchesShopDescription(entry.description, shop);
}

/** 自動で紐付ける組（請求 id → 明細 id）。決められない請求は入れない */
export function planAutoLinks(
  charges: LinkCharge[],
  entries: LinkEntry[],
  shops: LinkShop[],
): { chargeId: number; entryId: number }[] {
  const shopById = new Map(shops.map((s) => [s.id, s]));
  const candidates = new Map<number, LinkEntry[]>();
  const chargesOf = new Map<number, number[]>();
  for (const c of charges) {
    const shop = shopById.get(c.shopAccountId);
    if (!shop) continue;
    const list = entries.filter((e) => isAutoLinkable(c, e, shop));
    candidates.set(c.id, list);
    for (const e of list) chargesOf.set(e.id, [...(chargesOf.get(e.id) ?? []), c.id]);
  }

  const result: { chargeId: number; entryId: number }[] = [];
  const done = new Set<number>();
  // 候補の明細の集まりが同じ請求をまとめる
  const groups = new Map<string, number[]>();
  for (const [chargeId, list] of candidates) {
    if (list.length === 0) continue;
    const key = list
      .map((e) => e.id)
      .sort((a, b) => a - b)
      .join(",");
    groups.set(key, [...(groups.get(key) ?? []), chargeId]);
  }
  for (const [key, chargeIds] of groups) {
    const entryIds = key.split(",").map(Number);
    // 明細のほうも、この請求の集まり以外から候補にされていないこと
    const exclusive = entryIds.every((id) => {
      const owners = chargesOf.get(id) ?? [];
      return owners.length === chargeIds.length && owners.every((c) => chargeIds.includes(c));
    });
    if (!exclusive || entryIds.length !== chargeIds.length) continue;
    if (entryIds.length > 1) {
      // 2 組以上は、明細が互いに区別の付かないときだけ（どれと組んでも同じ）
      const list = candidates.get(chargeIds[0])!;
      const first = list[0];
      const same = list.every(
        (e) =>
          e.ymd === first.ymd &&
          yen(e.flow) === yen(first.flow) &&
          e.kind === first.kind &&
          e.sourceId === first.sourceId,
      );
      if (!same) continue;
    }
    const sortedCharges = [...chargeIds].sort((a, b) => a - b);
    sortedCharges.forEach((chargeId, i) => {
      if (done.has(chargeId)) return;
      done.add(chargeId);
      result.push({ chargeId, entryId: entryIds[i] });
    });
  }
  return result.sort((a, b) => a.chargeId - b.chargeId);
}

export type RankedCandidate = LinkEntry & {
  /** 明細の日付 − 請求日（日） */
  dayGap: number;
  /** 明細の出金額 − 請求額 */
  amountGap: number;
  /** 摘要が明細分けのキーワードに当たる */
  keywordMatch: boolean;
};

/**
 * 手で紐付けるときの候補の並び。金額の差が小さい順 → 摘要がキーワードに当たるもの → 日付の差が小さい順。
 * 出金の明細だけを出す
 */
export function rankCandidates(
  charge: LinkCharge,
  entries: LinkEntry[],
  shop: LinkShop,
): RankedCandidate[] {
  return entries
    .filter((e) => e.flow < 0)
    .map((e) => ({
      ...e,
      dayGap: dayGap(e.ymd, charge.ymd),
      amountGap: yen(-e.flow) - yen(charge.amount),
      keywordMatch: matchesShopDescription(e.description, shop),
    }))
    .sort(
      (a, b) =>
        Math.abs(a.amountGap) - Math.abs(b.amountGap) ||
        Number(b.keywordMatch) - Number(a.keywordMatch) ||
        Math.abs(a.dayGap) - Math.abs(b.dayGap) ||
        a.id - b.id,
    );
}

/**
 * 商品の金額を、明細の金額（total）に合うように割り振る（円単位）。
 * 合計が total と同じならそのまま。違えば金額の割合で割り振り、端数は絶対値がいちばん大きい商品に寄せる。
 * 商品の合計が 0 以下（割引だけなど）なら、total をいちばん大きい商品に入れる
 */
export function allocateToTotal(amounts: number[], total: number): number[] {
  if (amounts.length === 0) return [];
  const rounded = amounts.map(yen);
  const target = yen(total);
  const sum = rounded.reduce((a, b) => a + b, 0);
  if (sum === target) return rounded;
  let largest = 0;
  rounded.forEach((a, i) => {
    if (Math.abs(a) > Math.abs(rounded[largest])) largest = i;
  });
  if (sum <= 0) {
    return rounded.map((_, i) => (i === largest ? target : 0));
  }
  const scaled = rounded.map((a) => yen((a * target) / sum));
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  scaled[largest] += diff;
  return scaled;
}
