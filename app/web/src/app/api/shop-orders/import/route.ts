import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";
import { autoLinkShopCharges } from "@/lib/ledger/shop-link";
import { importShopCharges, planShopImport, ShopImportSchema } from "@/lib/ledger/shop-import";

// POST /api/shop-orders/import?shopAccountId=&dryRun= { charges } … 明細分け（通販の注文）の取り込み（editor 以上）。
//   CSV は画面で請求ごとにそろえて JSON で送る（lib/shared/shop-order-formats.ts。100KB・500 項目ほどずつに分けて送る）。取り込み済みの請求（同じ鍵）は飛ばす。
//   商品の科目は商品名の学習ルールで付ける。入れたあと、まだ紐付いていない請求をカード・銀行の明細に自動で紐付ける。
//   dryRun=1 は書き込まずに、期間・新しく入る件数・取り込み済みの件数・商品の件数を返す（preview）。
//   結果は inserted（入れた請求）・duplicate（取り込み済みで飛ばした請求）・linked（自動で紐付いた請求）・
//   uncategorizedItems（科目の付かなかった商品）
export const POST = withApi({
  role: "editor",
  querySchema: z.object({
    shopAccountId: z.coerce.number().int().positive(),
    dryRun: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
  }),
  schema: ShopImportSchema,
  handler: async ({ user, db, query, body, audit }) => {
    const shop = await db.shopAccount.findUnique({
      where: { id: query.shopAccountId },
      select: { id: true, businessUse: true },
    });
    if (!shop) throw notFound("明細分けが見つかりません");

    // ユーザー単位のレート制限（試しは別に数える）。画面は請求を 100KB・500 項目ほどずつに分けて送るので
    // （送る前の WAF が本文の大きさと項目の数で止めるため）、1 回の取り込みで何度か呼ばれる。明細の取り込みより多めにする
    const rate = query.dryRun
      ? await checkRateLimit(`rl:shop-import-preview:user:${user.id}`, 60, 600)
      : await checkRateLimit(`rl:shop-import:user:${user.id}`, 40, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

    if (query.dryRun) {
      return NextResponse.json({ preview: await planShopImport(db, shop.id, body) });
    }
    const result = await importShopCharges(db, user.tenantId, shop, body);
    const linked =
      result.inserted > 0 ? await autoLinkShopCharges(db, { shopAccountIds: [shop.id] }) : 0;
    await invalidateActualsCaches(user.tenantId);
    await audit("import", `shop_account:${shop.id}:${result.inserted}`, {
      after: { ...result, linked },
    });
    return NextResponse.json({ result: { ...result, linked } }, { status: 201 });
  },
});
