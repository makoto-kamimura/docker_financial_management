import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";
import { autoLinkShopCharges } from "@/lib/ledger/shop-link";

// POST /api/shop-orders/auto-link { shopAccountId? } … まだ紐付いていない明細分けの請求を、
//   金額と日付が合い相手が 1 つに決まる銀行・カードの明細に、自動で紐付ける（editor 以上）。
//   注文の取り込みとカード・銀行の明細の取り込みのあとにも同じ処理が走る。linked は紐付けた件数
export const POST = withApi({
  role: "editor",
  schema: z.object({ shopAccountId: z.number().int().positive().optional() }),
  handler: async ({ user, db, body, audit }) => {
    const linked = await autoLinkShopCharges(
      db,
      body.shopAccountId ? { shopAccountIds: [body.shopAccountId] } : {},
    );
    if (linked > 0) {
      await invalidateActualsCaches(user.tenantId);
      await audit("shop_auto_link", "shop_charges", { after: { linked } });
    }
    return NextResponse.json({ linked });
  },
});
