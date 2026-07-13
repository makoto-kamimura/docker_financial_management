import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

const UpdateSchema = z.object({
  customerName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().optional(),
  taxAmount: z.number().optional(),
  issueDate: zDate.optional(),
  dueDate: zDate.optional(),
  invoiceNumber: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/receivables/[id] … 売掛金 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const record = await db.receivable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!record) throw notFound();
    return NextResponse.json({ data: record });
  },
});

// PUT /api/receivables/[id] … 売掛金の更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.receivable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const record = await db.receivable.update({
      where: { id },
      data: {
        ...(body.customerName !== undefined && { customerName: body.customerName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.taxAmount !== undefined && { taxAmount: body.taxAmount }),
        ...(body.issueDate !== undefined && { issueDate: body.issueDate }),
        ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
        ...(body.invoiceNumber !== undefined && { invoiceNumber: body.invoiceNumber }),
        ...(body.note !== undefined && { note: body.note }),
      },
    });
    return NextResponse.json({ data: record });
  },
});

// DELETE /api/receivables/[id] … 売掛金の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.receivable.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.receivable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
