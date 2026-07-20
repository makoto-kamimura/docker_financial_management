import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound, conflict } from "@/lib/api-error";
import { requireAccountByCode } from "@/lib/period";
import { invalidateCache } from "@/lib/redis";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  branchName: z.string().optional().nullable(),
  accountType: z.string().optional(),
  role: z.enum(["SALARY", "WITHDRAWAL", "SAVINGS", "OTHER"]).optional(),
  lastFour: z.string().max(4).optional().nullable(),
  accountCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

// PATCH /api/bank-accounts/[id] … 銀行口座の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;
    const existing = await db.bankAccount.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    const { accountCode, ...fields } = body;
    let accountId: number | null | undefined;
    if (accountCode === null || accountCode === "") {
      accountId = null;
    } else if (accountCode) {
      const acct = await requireAccountByCode(db, tenantId, accountCode);
      accountId = acct.id;
    }

    const account = await db.bankAccount.update({
      where: { id },
      data: { ...fields, ...(accountId !== undefined ? { accountId } : {}) },
      include: { account: { select: { id: true, code: true, name: true, category: true } } },
    });
    await audit("update", `bank_account:${id}`);
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({ data: account });
  },
});

// DELETE /api/bank-accounts/[id] … 銀行口座の削除（editor 以上）
// 入出金明細・資金移動ルールが紐付いている口座は履歴保全のため削除できない（409）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const { tenantId } = user;
    const existing = await db.bankAccount.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    const [txnCount, transferCount] = await Promise.all([
      db.bankTransaction.count({ where: { accountId: id } }),
      db.transfer.count({
        where: { tenantId, OR: [{ fromAccountId: id }, { toAccountId: id }] },
      }),
    ]);
    if (txnCount > 0 || transferCount > 0) {
      throw conflict(
        "入出金明細または資金移動ルールが紐付いているため削除できません。先に明細・ルールを削除してください。",
      );
    }

    await db.bankAccount.delete({ where: { id } });
    await audit("delete", `bank_account:${id}`);
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return new NextResponse(null, { status: 204 });
  },
});
