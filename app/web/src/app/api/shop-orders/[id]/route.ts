import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";
import { unlinkCharge } from "@/lib/ledger/shop-link";

// DELETE /api/shop-orders/[id] … 明細分けの請求を消す（editor 以上）。商品も一緒に消える。
//   明細に紐付いていれば先に外す（明細は未割り当てに戻る）。実績を確定済みの月の明細に紐付いていれば 409
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const charge = await db.shopCharge.findUnique({
      where: { id },
      select: { orderNo: true, amount: true, entryId: true },
    });
    if (!charge) throw notFound("注文が見つかりません");
    await db.$transaction(async (tx) => {
      await unlinkCharge(tx, id);
      await tx.shopCharge.delete({ where: { id } });
    });
    await invalidateActualsCaches(user.tenantId);
    await audit("delete", `shop_charge:${id}`, {
      before: { orderNo: charge.orderNo, amount: Number(charge.amount), entryId: charge.entryId },
    });
    return new NextResponse(null, { status: 204 });
  },
});
