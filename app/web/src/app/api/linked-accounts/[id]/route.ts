import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { requireAccountByCode } from "@/lib/period";

const TYPES = ["BANK", "CREDIT_CARD"] as const;

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(TYPES).optional(),
  institution: z.string().min(1).optional(),
  lastFour: z.string().max(4).optional().nullable(),
  accountCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

// PATCH /api/linked-accounts/[id] … 口座・カードの更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;
    const existing = await db.linkedAccount.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    const { accountCode, ...fields } = body;
    let accountId: number | null | undefined;
    if (accountCode === null || accountCode === "") {
      accountId = null;
    } else if (accountCode) {
      const acct = await requireAccountByCode(db, tenantId, accountCode);
      accountId = acct.id;
    }

    const item = await db.linkedAccount.update({
      where: { id },
      data: { ...fields, ...(accountId !== undefined ? { accountId } : {}) },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    await audit("update", `linked_account:${id}`);
    return NextResponse.json({ data: item });
  },
});

// DELETE /api/linked-accounts/[id] … 口座・カードの削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const existing = await db.linkedAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.linkedAccount.delete({ where: { id } });
    await audit("delete", `linked_account:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
