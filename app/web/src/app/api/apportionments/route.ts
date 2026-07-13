import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const ApportionmentSchema = z.object({
  accountId: z.number().int().positive(),
  businessRate: z.number().min(0).max(100),
  description: z.string().optional(),
});

// GET /api/apportionments … 家事按分一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const list = await db.apportionment.findMany({
      where: { tenantId: user.tenantId },
      include: { account: { select: { id: true, code: true, name: true, category: true } } },
      orderBy: { account: { code: "asc" } },
    });
    return NextResponse.json({ data: list });
  },
});

// POST /api/apportionments … 家事按分の登録・更新（科目単位 upsert、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: ApportionmentSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;
    const record = await db.apportionment.upsert({
      where: { tenantId_accountId: { tenantId, accountId: body.accountId } },
      update: { businessRate: body.businessRate, description: body.description ?? null },
      create: {
        tenantId,
        accountId: body.accountId,
        businessRate: body.businessRate,
        description: body.description ?? null,
      },
      include: { account: { select: { id: true, code: true, name: true, category: true } } },
    });
    return NextResponse.json({ data: record });
  },
});

// DELETE /api/apportionments?accountId= … 家事按分の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ accountId: z.coerce.number().int().positive() }),
  handler: async ({ user, db, query }) => {
    await db.apportionment.delete({
      where: { tenantId_accountId: { tenantId: user.tenantId, accountId: query.accountId } },
    });
    return NextResponse.json({ ok: true });
  },
});
