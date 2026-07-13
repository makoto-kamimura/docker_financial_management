import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const UpdateSchema = z.object({
  status: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/invoices/[id] … インボイス 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const invoice = await db.invoice.findUnique({
      where: { id, tenantId: user.tenantId },
      include: { lines: true },
    });
    if (!invoice) throw notFound();
    return NextResponse.json({ data: invoice });
  },
});

// PUT /api/invoices/[id] … インボイスのステータス・備考更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.invoice.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const invoice = await db.invoice.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.note !== undefined && { note: body.note }),
      },
      include: { lines: true },
    });
    return NextResponse.json({ data: invoice });
  },
});

// DELETE /api/invoices/[id] … インボイスの削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.invoice.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.invoice.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
