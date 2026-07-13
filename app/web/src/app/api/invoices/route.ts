import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const INCLUDE = { lines: true };

const InvoiceSchema = z.object({
  customerName: z.string().min(1),
  customerAddress: z.string().optional(),
  issueDate: zDate,
  dueDate: zDate,
  note: z.string().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number(),
        unitPrice: z.number(),
        taxRate: z.number().optional(),
      }),
    )
    .min(1),
});

function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `INV-${y}${m}${d}-${r}`;
}

// GET /api/invoices?status= … インボイス一覧
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ status: z.string().optional() }),
  handler: async ({ user, db, query }) => {
    const invoices = await db.invoice.findMany({
      where: { tenantId: user.tenantId, ...(query.status ? { status: query.status } : {}) },
      include: INCLUDE,
      orderBy: { issueDate: "desc" },
    });
    return NextResponse.json({ data: invoices });
  },
});

// POST /api/invoices … インボイスの発行（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: InvoiceSchema,
  handler: async ({ user, db, body }) => {
    const lineData = body.lines.map((l) => {
      const taxRate = l.taxRate ?? 0.1;
      const amount = Math.round(l.quantity * l.unitPrice);
      return {
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate,
        amount,
      };
    });
    const subtotal = lineData.reduce((s, l) => s + l.amount, 0);
    const taxAmount = Math.round(lineData.reduce((s, l) => s + l.amount * l.taxRate, 0));
    const total = subtotal + taxAmount;

    const invoice = await db.invoice.create({
      data: {
        tenantId: user.tenantId,
        invoiceNumber: generateInvoiceNumber(),
        customerName: body.customerName,
        customerAddress: body.customerAddress ?? null,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        subtotal,
        taxAmount,
        total,
        note: body.note ?? null,
        lines: { create: lineData },
      },
      include: INCLUDE,
    });
    return NextResponse.json({ data: invoice }, { status: 201 });
  },
});
