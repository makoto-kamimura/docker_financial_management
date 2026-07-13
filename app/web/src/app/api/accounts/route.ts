import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";

const CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "ASSET", "LIABILITY", "OTHER"] as const;

const AccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(CATEGORIES).default("OTHER"),
  parentCode: z.string().optional(),
  soleName: z.string().max(255).optional(),
  corporateName: z.string().max(255).optional(),
});

// GET /api/accounts … 勘定科目一覧（要ログイン）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const accounts = await db.account.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { code: "asc" },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });
    return NextResponse.json({ data: accounts });
  },
});

// POST /api/accounts … 勘定科目の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: AccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const { parentCode, ...fields } = body;
    const { tenantId } = user;

    let parentId: number | undefined;
    if (parentCode) {
      const parent = await findAccountByCode(db, tenantId, parentCode);
      if (!parent) throw badRequest(`unknown parentCode: ${parentCode}`);
      parentId = parent.id;
    }

    const account = await db.account.create({ data: { tenantId, ...fields, parentId } });
    await audit("create", `account:${account.id}`);
    return NextResponse.json({ data: account }, { status: 201 });
  },
});
