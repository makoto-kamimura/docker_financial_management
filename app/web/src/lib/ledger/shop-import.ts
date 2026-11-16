// 明細分け（通販の注文）の取り込み（POST /api/shop-orders/import）。CSV はブラウザで請求ごとにそろえ
// （lib/shared/shop-order-formats.ts）、ここでは重複を飛ばして請求と商品を入れる。
//   - 重複: 明細分けごとに、請求の鍵（Amazon は 注文番号|発送日）が同じものは入れない
//   - 商品の科目: 商品名の学習ルールで付ける（lib/ledger/shop-link.ts の loadShopItemClassifier）。
//     当たらなければ科目なし（履歴で付ける）
//   - 事業利用: ルールが決めていればそれ、決めていなければ明細分けの事業利用（科目の事業利用按分の割合、無ければ 100%）
// 入れたあとの自動の紐付けは呼び出し側（autoLinkShopCharges）。
import { z } from "zod";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { loadApportionmentRates, NOT_BUSINESS } from "@/lib/ledger/business-use";
import { loadShopItemClassifier } from "@/lib/ledger/shop-link";
import { defaultBusinessRatio } from "@/lib/shared/business-use";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MAX_SHOP_IMPORT_CHARGES = 5000;

export const ShopImportSchema = z.object({
  charges: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(200),
        orderNo: z.string().trim().min(1).max(100),
        date: ymd,
        amount: z.number().positive().max(100_000_000),
        sellerName: z.string().max(200).nullish(),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(500),
              quantity: z.number().int().min(1).max(99_999),
              amount: z.number().min(-100_000_000).max(100_000_000),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .min(1)
    .max(MAX_SHOP_IMPORT_CHARGES),
});
export type ShopImportInput = z.infer<typeof ShopImportSchema>;

/** 取り込みの前の確認（期間・新しく入る件数・取り込み済みの件数） */
export async function planShopImport(
  db: TenantDbClient,
  shopAccountId: number,
  input: ShopImportInput,
) {
  const fresh = await freshCharges(db, shopAccountId, input);
  const dates = input.charges.map((c) => c.date).sort();
  return {
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    fresh: fresh.length,
    duplicate: input.charges.length - fresh.length,
    items: fresh.reduce((n, c) => n + c.items.length, 0),
  };
}

/** まだ入っていない請求（同じ CSV の中の重複も 1 つにする） */
async function freshCharges(db: TenantDbClient, shopAccountId: number, input: ShopImportInput) {
  const keys = [...new Set(input.charges.map((c) => c.key))];
  const existing = await db.shopCharge.findMany({
    where: { shopAccountId, externalKey: { in: keys } },
    select: { externalKey: true },
  });
  const seen = new Set(existing.map((e) => e.externalKey));
  return input.charges.filter((c) => !seen.has(c.key) && (seen.add(c.key), true));
}

/** 請求と商品を入れる。入れた請求の件数と、科目の付かなかった商品の件数を返す */
export async function importShopCharges(
  db: TenantDbClient,
  tenantId: number,
  shop: { id: number; businessUse: boolean },
  input: ShopImportInput,
): Promise<{ inserted: number; duplicate: number; uncategorizedItems: number }> {
  const fresh = await freshCharges(db, shop.id, input);
  const [classify, rates] = await Promise.all([
    loadShopItemClassifier(db),
    shop.businessUse ? loadApportionmentRates(db) : Promise.resolve(new Map<number, number>()),
  ]);
  let uncategorizedItems = 0;
  for (const c of fresh) {
    await db.shopCharge.create({
      data: {
        tenantId,
        shopAccountId: shop.id,
        orderNo: c.orderNo,
        date: new Date(`${c.date}T00:00:00Z`),
        amount: c.amount,
        sellerName: c.sellerName ?? null,
        externalKey: c.key,
        items: {
          create: c.items.map((item, i) => {
            const hit = classify(item.name);
            if (!hit) uncategorizedItems++;
            const categoryAccountId = hit?.categoryAccountId ?? null;
            const business =
              hit?.business ??
              (shop.businessUse
                ? {
                    businessUse: true,
                    businessRatio: defaultBusinessRatio(
                      categoryAccountId === null ? null : rates.get(categoryAccountId),
                    ),
                  }
                : NOT_BUSINESS);
            return {
              tenantId,
              name: item.name,
              quantity: item.quantity,
              amount: item.amount,
              categoryAccountId,
              ...business,
              sortOrder: i,
            };
          }),
        },
      },
    });
  }
  return {
    inserted: fresh.length,
    duplicate: input.charges.length - fresh.length,
    uncategorizedItems,
  };
}
