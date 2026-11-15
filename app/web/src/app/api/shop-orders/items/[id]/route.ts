import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";
import { BusinessInput, loadApportionmentRates, resolveBusiness } from "@/lib/ledger/business-use";
import { assertChargeEditable, learnShopItemRule, syncChargeEntries } from "@/lib/ledger/shop-link";
import { SHOP_CHARGE_INCLUDE, toShopChargeDto } from "@/lib/ledger/shop-orders";

// PATCH /api/shop-orders/items/[id] { categoryAccountId?, businessUse?, businessRatio?, learn? }
//   … 明細分けの商品の科目・事業利用を変える（editor 以上）。省略した項目は変えない。
//   請求が明細に紐付いていれば、商品ごとの行（内訳）を作り直す（実績を確定済みの月なら 409）。
//   learn なら、商品名と科目（と指定したときは事業利用）を商品名の学習ルールに覚える。
//   按分を省略して事業利用にしたときは、科目の事業利用按分の割合（無ければ 100%）にする。
//   応答はその商品の請求（GET /api/shop-orders の 1 行と同じ形）
export const PATCH = withApi({
  role: "editor",
  schema: BusinessInput.extend({
    categoryAccountId: z.number().int().positive().nullable().optional(),
    learn: z.boolean().optional(),
  }),
  handler: async ({ user, db, id, body, audit }) => {
    const item = await db.shopOrderItem.findUnique({
      where: { id },
      select: {
        chargeId: true,
        name: true,
        categoryAccountId: true,
        businessUse: true,
        businessRatio: true,
      },
    });
    if (!item) throw notFound("商品が見つかりません");
    if (body.categoryAccountId) {
      const account = await db.account.findUnique({
        where: { id: body.categoryAccountId },
        select: { id: true },
      });
      if (!account) throw notFound("科目が見つかりません");
    }
    const categoryAccountId =
      body.categoryAccountId === undefined ? item.categoryAccountId : body.categoryAccountId;
    const business = resolveBusiness(
      body,
      categoryAccountId,
      body.businessUse === true && body.businessRatio == null
        ? await loadApportionmentRates(db)
        : new Map(),
    );

    await db.$transaction(async (tx) => {
      await assertChargeEditable(tx, item.chargeId);
      await tx.shopOrderItem.update({
        where: { id },
        data: { categoryAccountId, ...business },
      });
      if (body.learn && categoryAccountId !== null) {
        await learnShopItemRule(tx, user.tenantId, item.name, categoryAccountId, business);
      }
      await syncChargeEntries(tx, item.chargeId);
    });

    await invalidateActualsCaches(user.tenantId);
    await audit("shop_item_categorize", `shop_order_item:${id}`, {
      before: {
        categoryAccountId: item.categoryAccountId,
        businessUse: item.businessUse,
        businessRatio: item.businessRatio === null ? null : Number(item.businessRatio),
      },
      after: { categoryAccountId, ...business },
    });
    const charge = await db.shopCharge.findUniqueOrThrow({
      where: { id: item.chargeId },
      include: SHOP_CHARGE_INCLUDE,
    });
    return NextResponse.json({ data: toShopChargeDto(charge) });
  },
});
