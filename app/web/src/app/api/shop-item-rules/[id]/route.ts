import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, conflict, notFound } from "@/lib/server/api-error";
import { normalizeKeyword } from "@/lib/ledger/banktxn-import";

// PATCH /api/shop-item-rules/[id] { keyword?, categoryAccountId? } … 商品名の学習ルールを直す（editor 以上）。
//   長い商品名で覚えたキーワードを短くして、似た商品にも当たるようにするなど。同じキーワードのルールがあれば 409。
//   ルールを変えても、すでに付いている商品の科目は変えない。
// DELETE /api/shop-item-rules/[id] … ルールを消す
export const PATCH = withApi({
  role: "editor",
  schema: z.object({
    keyword: z.string().max(200).optional(),
    categoryAccountId: z.number().int().positive().optional(),
  }),
  handler: async ({ db, id, body, audit }) => {
    const rule = await db.shopItemRule.findUnique({ where: { id } });
    if (!rule) throw notFound("ルールが見つかりません");
    const keyword = body.keyword === undefined ? undefined : normalizeKeyword(body.keyword);
    if (keyword === "") throw badRequest("キーワードを入れてください");
    if (keyword && keyword !== rule.keyword) {
      const dup = await db.shopItemRule.findFirst({ where: { keyword, id: { not: id } } });
      if (dup) throw conflict("同じキーワードのルールがあります");
    }
    if (body.categoryAccountId) {
      const account = await db.account.findFirst({
        where: { id: body.categoryAccountId, category: { in: ["REVENUE", "COGS", "EXPENSE"] } },
        select: { id: true },
      });
      if (!account) throw badRequest("収入・支出の科目を選んでください");
    }
    const updated = await db.shopItemRule.update({
      where: { id },
      data: {
        ...(keyword ? { keyword } : {}),
        ...(body.categoryAccountId ? { categoryAccountId: body.categoryAccountId } : {}),
      },
    });
    await audit("update", `shop_item_rule:${id}`, {
      before: { keyword: rule.keyword, categoryAccountId: rule.categoryAccountId },
      after: { keyword: updated.keyword, categoryAccountId: updated.categoryAccountId },
    });
    return NextResponse.json({ data: updated });
  },
});

export const DELETE = withApi({
  role: "editor",
  handler: async ({ db, id, audit }) => {
    const rule = await db.shopItemRule.findUnique({ where: { id } });
    if (!rule) throw notFound("ルールが見つかりません");
    await db.shopItemRule.delete({ where: { id } });
    await audit("delete", `shop_item_rule:${id}`, {
      before: { keyword: rule.keyword, categoryAccountId: rule.categoryAccountId },
    });
    return new NextResponse(null, { status: 204 });
  },
});
