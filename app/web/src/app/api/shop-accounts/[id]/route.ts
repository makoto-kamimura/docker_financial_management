import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { conflict, notFound } from "@/lib/server/api-error";
import { assertPaymentSources, ShopAccountUpdateSchema } from "@/lib/ledger/shop-account-schema";

// PATCH /api/shop-accounts/[id] … 明細分けの更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: ShopAccountUpdateSchema,
  handler: async ({ db, id, body, audit }) => {
    const existing = await db.shopAccount.findUnique({ where: { id } });
    if (!existing) throw notFound();
    await assertPaymentSources(db, body.paymentCardIds, body.paymentBankIds);
    const item = await db.shopAccount.update({ where: { id }, data: body });
    await audit("update", `shop_account:${id}`);
    return NextResponse.json({ data: item });
  },
});

// DELETE /api/shop-accounts/[id] … 明細分けの削除（editor 以上）
//   取り込んだ注文があれば消さない（409。カード・電子マネーと同じく、履歴を残すため）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ db, id, audit }) => {
    const existing = await db.shopAccount.findUnique({ where: { id } });
    if (!existing) throw notFound();
    const charges = await db.shopCharge.count({ where: { shopAccountId: id } });
    if (charges > 0) {
      throw conflict("取り込んだ注文があるため削除できません。先に注文を削除してください。");
    }
    await db.shopAccount.delete({ where: { id } });
    await audit("delete", `shop_account:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
