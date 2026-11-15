// 明細分け（通販の注文）の請求を API の応答の形にする（GET /api/shop-orders と、紐付け・商品の科目の変更の応答）。
import type { Prisma } from "@prisma/client";
import { toYmd } from "@/lib/ledger/actuals-coverage";
import { allocateToTotal } from "@/lib/ledger/shop-link-core";
import { chargeYmd } from "@/lib/ledger/shop-link";

export const SHOP_CHARGE_INCLUDE = {
  shopAccount: { select: { id: true, name: true, type: true } },
  entry: {
    select: {
      id: true,
      kind: true,
      date: true,
      description: true,
      flow: true,
      bankAccount: { select: { name: true } },
      cardAccount: { select: { name: true } },
    },
  },
  items: {
    select: {
      id: true,
      name: true,
      quantity: true,
      amount: true,
      categoryAccountId: true,
      categoryAccount: { select: { id: true, code: true, name: true, category: true } },
      businessUse: true,
      businessRatio: true,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ShopChargeInclude;

type ChargeRow = Prisma.ShopChargeGetPayload<{ include: typeof SHOP_CHARGE_INCLUDE }>;

export function toShopChargeDto(c: ChargeRow) {
  const entry = c.entry;
  // 紐付けた明細の金額に合わせて割り振った商品の金額（内訳の行の金額と同じ）
  const allocated = entry
    ? allocateToTotal(
        c.items.map((i) => Number(i.amount)),
        Math.abs(Number(entry.flow ?? 0)),
      )
    : null;
  return {
    id: c.id,
    shopAccount: c.shopAccount,
    orderNo: c.orderNo,
    date: chargeYmd(c.date),
    amount: Number(c.amount),
    sellerName: c.sellerName,
    linkedBy: c.linkedBy,
    entry: entry
      ? {
          id: entry.id,
          kind: entry.kind,
          date: entry.date ? toYmd(entry.date) : null,
          description: entry.description,
          /** +入金 / −出金 */
          amount: Number(entry.flow ?? 0),
          sourceName: entry.bankAccount?.name ?? entry.cardAccount?.name ?? "現金",
        }
      : null,
    items: c.items.map((i, idx) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      amount: Number(i.amount),
      /** 明細に紐付いていれば、明細の金額に合わせて割り振った額（実績の額）。紐付いていなければ null */
      allocatedAmount: allocated ? allocated[idx] : null,
      categoryAccountId: i.categoryAccountId,
      categoryAccount: i.categoryAccount,
      businessUse: i.businessUse,
      businessRatio: i.businessRatio === null ? null : Number(i.businessRatio),
    })),
    uncategorizedCount: c.items.filter((i) => i.categoryAccountId === null).length,
  };
}

export type ShopChargeDto = ReturnType<typeof toShopChargeDto>;
