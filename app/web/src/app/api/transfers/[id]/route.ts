import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const PatchSchema = z.object({
  fromAccountId: z.number().int().nullable().optional(),
  toAccountId: z.number().int().nullable().optional(),
  amount: z.number().positive().optional(),
  kind: z.enum(["MANUAL", "AUTO"]).optional(),
  channel: z.enum(["BANK_TRANSFER", "AUTO_DEBIT", "CARD_PAYMENT", "INCOME", "EXPENSE"]).optional(),
  label: z.string().optional(),
  day: z.number().int().min(1).max(31).optional(),
  note: z.string().optional(),
});

// PATCH /api/transfers/[id] … 資金移動ルールの更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: PatchSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const existing = await db.transfer.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const transfer = await db.transfer.update({ where: { id }, data: body });
    await audit("update", `transfer:${id}`);
    return NextResponse.json({ data: transfer });
  },
});

// DELETE /api/transfers/[id] … 資金移動ルールの削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const existing = await db.transfer.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.transfer.delete({ where: { id } });
    await audit("delete", `transfer:${id}`);
    return NextResponse.json({ ok: true });
  },
});
