import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

const UpdateSchema = z.object({
  supplierName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().optional(),
  taxAmount: z.number().optional(),
  issueDate: zDate.optional(),
  dueDate: zDate.optional(),
  note: z.string().optional(),
});

// GET /api/payables/[id] … 買掛金 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const record = await db.payable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!record) throw notFound();
    return NextResponse.json({ data: record });
  },
});

// PUT /api/payables/[id] … 買掛金の更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.payable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const record = await db.payable.update({
      where: { id },
      data: {
        ...(body.supplierName !== undefined && { supplierName: body.supplierName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.taxAmount !== undefined && { taxAmount: body.taxAmount }),
        ...(body.issueDate !== undefined && { issueDate: body.issueDate }),
        ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
        ...(body.note !== undefined && { note: body.note }),
      },
    });
    return NextResponse.json({ data: record });
  },
});

// DELETE /api/payables/[id] … 買掛金の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.payable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.payable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
