import { z } from "zod";
import { badRequest } from "@/lib/server/api-error";
import type { TenantDb } from "@/lib/server/tenant-db";
import { statementUrlInput } from "@/lib/shared/statement-links";
import { SHOP_ACCOUNT_TYPES } from "@/lib/shared/shop-account-type";

// 明細分け（ShopAccount）の API の入力と、支払いに使うカード・口座の確かめ。
// /api/shop-accounts の POST と /api/shop-accounts/[id] の PATCH で使う。

const keywords = z.array(z.string().trim().min(1).max(50)).max(20);
const ids = z.array(z.number().int().positive()).max(50);

export const ShopAccountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(SHOP_ACCOUNT_TYPES).default("OTHER"),
  matchKeywords: keywords.default([]),
  excludeKeywords: keywords.default([]),
  paymentCardIds: ids.default([]),
  paymentBankIds: ids.default([]),
  // 注文履歴のページの URL（空欄は既定に戻す）
  statementUrl: statementUrlInput,
  businessUse: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export const ShopAccountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(SHOP_ACCOUNT_TYPES).optional(),
  matchKeywords: keywords.optional(),
  excludeKeywords: keywords.optional(),
  paymentCardIds: ids.optional(),
  paymentBankIds: ids.optional(),
  statementUrl: statementUrlInput,
  businessUse: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** 支払いに使うカード・口座が、このテナントのものかを確かめる（無いものがあれば 400） */
export async function assertPaymentSources(
  db: TenantDb,
  cardIds: number[] | undefined,
  bankIds: number[] | undefined,
): Promise<void> {
  const [cards, banks] = await Promise.all([
    cardIds?.length ? db.linkedAccount.count({ where: { id: { in: cardIds } } }) : 0,
    bankIds?.length ? db.bankAccount.count({ where: { id: { in: bankIds } } }) : 0,
  ]);
  if (cards !== new Set(cardIds ?? []).size || banks !== new Set(bankIds ?? []).size) {
    throw badRequest("支払いに使うカード・口座が見つかりません");
  }
}
