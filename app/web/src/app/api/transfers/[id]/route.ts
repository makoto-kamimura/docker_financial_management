import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { TransferPatchSchema } from "@/lib/transfer-schema";

// PATCH /api/transfers/[id] … 資金移動ルールの更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: TransferPatchSchema,
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
