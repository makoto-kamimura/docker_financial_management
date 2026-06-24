import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// GET /api/receivables/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const record = await prisma.receivable.findUnique({ where: { id: Number(id) } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: record });
}

// PUT /api/receivables/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json() as Partial<{
    customerName: string; description: string; amount: number; taxAmount: number;
    issueDate: string; dueDate: string; invoiceNumber: string; note: string;
  }>;

  const record = await prisma.receivable.update({
    where: { id: Number(id) },
    data: {
      ...(body.customerName  !== undefined && { customerName:  body.customerName }),
      ...(body.description   !== undefined && { description:   body.description }),
      ...(body.amount        !== undefined && { amount:        body.amount }),
      ...(body.taxAmount     !== undefined && { taxAmount:     body.taxAmount }),
      ...(body.issueDate     !== undefined && { issueDate:     new Date(body.issueDate) }),
      ...(body.dueDate       !== undefined && { dueDate:       new Date(body.dueDate) }),
      ...(body.invoiceNumber !== undefined && { invoiceNumber: body.invoiceNumber }),
      ...(body.note          !== undefined && { note:          body.note }),
    },
  });
  return NextResponse.json({ data: record });
}

// DELETE /api/receivables/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.receivable.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
