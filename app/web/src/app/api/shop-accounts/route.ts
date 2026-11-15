import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { businessOwnedWhere, ScopeQuery } from "@/lib/ledger/scope";
import { assertPaymentSources, ShopAccountSchema } from "@/lib/ledger/shop-account-schema";

// GET /api/shop-accounts … 明細分け（明細管理で登録する通販の注文の取り込み先）の一覧
//   件数を添える: chargeCount（取り込んだ請求）・unlinkedCount（カード・銀行の明細に紐付いていない請求）・
//   uncategorizedCount（科目の付いていない商品）・lastImportedAt（最後に請求を取り込んだ日時）
//   scope=business（個人事業主モード）は事業利用のものだけ
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery,
  handler: async ({ db, query }) => {
    const [items, charges, unlinked, uncategorized] = await Promise.all([
      db.shopAccount.findMany({
        where: businessOwnedWhere(query.scope),
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      db.shopCharge.groupBy({
        by: ["shopAccountId"],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      db.shopCharge.groupBy({
        by: ["shopAccountId"],
        where: { entryId: null },
        _count: { _all: true },
      }),
      db.shopCharge.findMany({
        where: { items: { some: { categoryAccountId: null } } },
        select: {
          shopAccountId: true,
          _count: { select: { items: { where: { categoryAccountId: null } } } },
        },
      }),
    ]);

    const chargeBy = new Map(charges.map((g) => [g.shopAccountId, g]));
    const unlinkedBy = new Map(unlinked.map((g) => [g.shopAccountId, g._count._all]));
    const uncategorizedBy = new Map<number, number>();
    for (const c of uncategorized) {
      uncategorizedBy.set(
        c.shopAccountId,
        (uncategorizedBy.get(c.shopAccountId) ?? 0) + c._count.items,
      );
    }

    return NextResponse.json({
      data: items.map((a) => ({
        ...a,
        chargeCount: chargeBy.get(a.id)?._count._all ?? 0,
        unlinkedCount: unlinkedBy.get(a.id) ?? 0,
        uncategorizedCount: uncategorizedBy.get(a.id) ?? 0,
        lastImportedAt: chargeBy.get(a.id)?._max.createdAt ?? null,
      })),
    });
  },
});

// POST /api/shop-accounts … 明細分けの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: ShopAccountSchema,
  handler: async ({ user, db, body, audit }) => {
    await assertPaymentSources(db, body.paymentCardIds, body.paymentBankIds);
    const item = await db.shopAccount.create({ data: { tenantId: user.tenantId, ...body } });
    await audit("create", `shop_account:${item.id}`);
    return NextResponse.json({ data: item }, { status: 201 });
  },
});
