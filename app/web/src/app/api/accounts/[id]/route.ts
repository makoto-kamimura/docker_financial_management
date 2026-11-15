import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { ACCOUNT_CATEGORIES } from "@/lib/accounting/account-category";
import { badRequest, conflict, notFound } from "@/lib/server/api-error";
import { findAccountByCode } from "@/lib/accounting/period";

const UpdateSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  category: z.enum(ACCOUNT_CATEGORIES).optional(),
  parentCode: z.string().optional().nullable(),
  soleName: z.string().max(255).nullable().optional(),
  corporateName: z.string().max(255).nullable().optional(),
});

// PATCH /api/accounts/[id] … 勘定科目の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const { parentCode, code, ...fields } = body;
    const { tenantId } = user;

    const before = await db.account.findUnique({ where: { id, tenantId } });
    if (!before) throw notFound();

    if (code && code !== before.code) {
      const dup = await findAccountByCode(db, tenantId, code);
      if (dup) throw conflict(`コード「${code}」は既に使用されています`);
    }

    let parentId: number | null | undefined;
    if (parentCode === null || parentCode === "") {
      parentId = null;
    } else if (parentCode) {
      const parent = await findAccountByCode(db, tenantId, parentCode);
      if (!parent) throw badRequest(`unknown parentCode: ${parentCode}`);
      if (parent.id === id) throw badRequest("cannot self-reference");
      parentId = parent.id;
    }

    const account = await db.account.update({
      where: { id },
      data: {
        ...(code ? { code } : {}),
        ...fields,
        ...(parentId !== undefined ? { parentId } : {}),
      },
    });
    await audit("update", `account:${id}`, { before, after: account });
    return NextResponse.json({ data: account });
  },
});

// DELETE /api/accounts/[id] … 勘定科目の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const { tenantId } = user;
    const before = await db.account.findUnique({ where: { id, tenantId } });
    if (!before) throw notFound();

    const hasRecords = await db.financialRecord.findFirst({ where: { accountId: id, tenantId } });
    if (hasRecords) throw conflict("実績データが存在するため削除できません");

    const hasChildren = await db.account.findFirst({ where: { parentId: id, tenantId } });
    if (hasChildren) throw conflict("子勘定科目が存在するため削除できません");

    // 明細分け（通販の注文）の商品に付いている科目は消さない（商品の科目を付け替えてから）
    const hasShopItems = await db.shopOrderItem.findFirst({ where: { categoryAccountId: id } });
    if (hasShopItems) throw conflict("明細分けの商品に使われているため削除できません");

    // 商品名の学習ルールは、科目と一緒に消す
    await db.$transaction(async (tx) => {
      await tx.shopItemRule.deleteMany({ where: { categoryAccountId: id } });
      await tx.account.delete({ where: { id } });
    });
    await audit("delete", `account:${id}`, { before });
    return new NextResponse(null, { status: 204 });
  },
});
