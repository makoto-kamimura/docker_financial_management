import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { requireAccountByCode } from "@/lib/period";

const TYPES = ["BANK", "CREDIT_CARD"] as const;

const LinkedAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(TYPES),
  institution: z.string().min(1),
  lastFour: z.string().max(4).optional(),
  accountCode: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/linked-accounts … 口座・カード台帳一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const items = await db.linkedAccount.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ type: "asc" }, { institution: "asc" }],
      include: {
        account: { select: { id: true, code: true, name: true, category: true } },
      },
    });
    return NextResponse.json({ data: items });
  },
});

// POST /api/linked-accounts … 口座・カードの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: LinkedAccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const { accountCode, ...fields } = body;
    const { tenantId } = user;

    let accountId: number | undefined;
    if (accountCode) {
      const acct = await requireAccountByCode(db, tenantId, accountCode);
      accountId = acct.id;
    }

    const item = await db.linkedAccount.create({ data: { tenantId, ...fields, accountId } });
    await audit("create", `linked_account:${item.id}`);
    return NextResponse.json({ data: item }, { status: 201 });
  },
});
