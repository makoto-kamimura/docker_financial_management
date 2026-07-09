import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

const INCLUDE = { lines: true };

function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `INV-${y}${m}${d}-${r}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const status = req.nextUrl.searchParams.get("status");
  const invoices = await db.invoice.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    include: INCLUDE,
    orderBy: { issueDate: "desc" },
  });
  return NextResponse.json({ data: invoices });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    customerName: string;
    customerAddress?: string;
    issueDate: string;
    dueDate: string;
    note?: string;
    lines: { description: string; quantity: number; unitPrice: number; taxRate?: number }[];
  };
  if (!body.customerName || !body.issueDate || !body.dueDate || !body.lines?.length) {
    return NextResponse.json(
      { error: "customerName, issueDate, dueDate, lines are required" },
      { status: 400 },
    );
  }

  const lineData = body.lines.map((l) => {
    const taxRate = l.taxRate ?? 0.1;
    const amount = Math.round(l.quantity * l.unitPrice);
    return { description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate, amount };
  });
  const subtotal = lineData.reduce((s, l) => s + l.amount, 0);
  const taxAmount = Math.round(lineData.reduce((s, l) => s + l.amount * l.taxRate, 0));
  const total = subtotal + taxAmount;

  const invoice = await db.invoice.create({
    data: {
      tenantId,
      invoiceNumber: generateInvoiceNumber(),
      customerName: body.customerName,
      customerAddress: body.customerAddress ?? null,
      issueDate: new Date(body.issueDate),
      dueDate: new Date(body.dueDate),
      subtotal,
      taxAmount,
      total,
      note: body.note ?? null,
      lines: { create: lineData },
    },
    include: INCLUDE,
  });
  return NextResponse.json({ data: invoice }, { status: 201 });
}
