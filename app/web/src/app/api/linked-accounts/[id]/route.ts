import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";
import { requireAccountByCode } from "@/lib/period";
import { LINKED_ACCOUNT_TYPES } from "@/lib/linked-account-type";

// D-1: 銀行口座は /api/bank-accounts に一本化。本 API はカード・電子マネーを扱う
const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(LINKED_ACCOUNT_TYPES).optional(),
  institution: z.string().min(1).optional(),
  lastFour: z.string().max(4).optional().nullable(),
  accountCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

// PATCH /api/linked-accounts/[id] … クレジットカード・電子マネーの更新（editor 以上）
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

// DELETE /api/linked-accounts/[id] … クレジットカード・電子マネーの削除（editor 以上）
// 利用明細が紐付いている場合は履歴保全のため削除できない（409。bank-accounts と同パターン）。
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const existing = await db.linkedAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const txnCount = await db.cardTransaction.count({ where: { accountId: id } });
    if (txnCount > 0) {
      throw conflict("利用明細が紐付いているため削除できません。先に明細を削除してください。");
    }

    await db.linkedAccount.delete({ where: { id } });
    await audit("delete", `linked_account:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
