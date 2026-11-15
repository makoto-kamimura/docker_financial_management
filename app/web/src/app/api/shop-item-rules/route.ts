import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";

// GET /api/shop-item-rules … 明細分けの商品名の学習ルールの一覧（キーワード順）。実績管理の「設定」タブで使う。
//   商品の科目を付けたときに覚え（PATCH /api/shop-orders/items/[id] の learn）、注文の取り込みで当てる。
export const GET = withApi({
  role: "viewer",
  handler: async ({ db }) => {
    const rows = await db.shopItemRule.findMany({
      orderBy: [{ keyword: "asc" }, { id: "asc" }],
      select: {
        id: true,
        keyword: true,
        priority: true,
        businessUse: true,
        businessRatio: true,
        updatedAt: true,
        categoryAccount: {
          select: { id: true, code: true, name: true, soleName: true, corporateName: true },
        },
      },
    });
    return NextResponse.json({
      data: rows.map((r) => ({
        ...r,
        businessRatio: r.businessRatio === null ? null : Number(r.businessRatio),
      })),
    });
  },
});
