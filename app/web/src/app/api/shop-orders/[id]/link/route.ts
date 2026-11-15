import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";
import { linkCharge, unlinkCharge } from "@/lib/ledger/shop-link";
import { SHOP_CHARGE_INCLUDE, toShopChargeDto } from "@/lib/ledger/shop-orders";

// POST /api/shop-orders/[id]/link { entryId } … 明細分けの請求を、銀行・カードの出金の明細に手で紐付ける（editor 以上）。
//   金額が違ってもよい（商品の金額の割合で割り振る）。明細は科目を外し、商品ごとの行（内訳）が実績になる
//   （lib/ledger/shop-link.ts）。もう紐付いている請求・明細、振替・チャージの明細、入金の明細は 400 / 409。
//   実績を確定済みの月の明細は 409
// DELETE /api/shop-orders/[id]/link … 紐付けを外す（明細は未割り当てに戻る）
export const POST = withApi({
  role: "editor",
  schema: z.object({ entryId: z.number().int().positive() }),
  handler: async ({ user, db, id, body, audit }) => {
    await db.$transaction((tx) => linkCharge(tx, id, body.entryId, "MANUAL"));
    await invalidateActualsCaches(user.tenantId);
    await audit("shop_link", `shop_charge:${id}`, { after: { entryId: body.entryId } });
    const charge = await db.shopCharge.findUniqueOrThrow({
      where: { id },
      include: SHOP_CHARGE_INCLUDE,
    });
    return NextResponse.json({ data: toShopChargeDto(charge) });
  },
});

export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const entryId = await db.$transaction((tx) => unlinkCharge(tx, id));
    await invalidateActualsCaches(user.tenantId);
    await audit("shop_unlink", `shop_charge:${id}`, { before: { entryId } });
    const charge = await db.shopCharge.findUniqueOrThrow({
      where: { id },
      include: SHOP_CHARGE_INCLUDE,
    });
    return NextResponse.json({ data: toShopChargeDto(charge) });
  },
});
