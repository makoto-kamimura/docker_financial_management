import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { SHOP_CHARGE_INCLUDE, toShopChargeDto } from "@/lib/ledger/shop-orders";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// GET /api/shop-orders?shopAccountId=&status=&dateFrom=&dateTo=&q=&limit=&offset=
//   … 明細分け（通販の注文）の請求の一覧（新しい順。実績管理の「履歴」の出どころ「明細分け」）。
//   - status: all / unlinked（カード・銀行の明細に紐付いていない）/ uncategorized（科目の無い商品がある）
//   - q: 注文番号・店名・商品名の部分一致
//   行は請求ごとに、紐付けた明細と商品（科目・事業利用・割り振った金額）を持つ（lib/ledger/shop-orders.ts）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    shopAccountId: z.coerce.number().int().positive().optional(),
    status: z.enum(["all", "unlinked", "uncategorized"]).default("all"),
    dateFrom: ymd.optional(),
    dateTo: ymd.optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  handler: async ({ db, query }) => {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw badRequest("期間の始まりが終わりより後になっています");
    }
    const where: Prisma.ShopChargeWhereInput = {
      ...(query.shopAccountId ? { shopAccountId: query.shopAccountId } : {}),
      ...(query.status === "unlinked" ? { entryId: null } : {}),
      ...(query.status === "uncategorized" ? { items: { some: { categoryAccountId: null } } } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            date: {
              ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00Z`) } : {}),
              ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00Z`) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { orderNo: { contains: query.q, mode: "insensitive" } },
              { sellerName: { contains: query.q, mode: "insensitive" } },
              { items: { some: { name: { contains: query.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.shopCharge.findMany({
        where,
        include: SHOP_CHARGE_INCLUDE,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
      db.shopCharge.count({ where }),
    ]);
    return NextResponse.json({
      data: rows.map(toShopChargeDto),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
});
