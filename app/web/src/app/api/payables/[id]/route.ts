import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// GET /api/payables/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const record = await prisma.payable.findUnique({ where: { id: Number(id) } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: record });
}

// PUT /api/payables/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json() as Partial<{
    supplierName: string; description: string; amount: number; taxAmount: number;
    issueDate: string; dueDate: string; note: string;
  }>;

  const record = await prisma.payable.update({
    where: { id: Number(id) },
    data: {
      ...(body.supplierName !== undefined && { supplierName: body.supplierName }),
      ...(body.description  !== undefined && { description:  body.description }),
      ...(body.amount       !== undefined && { amount:       body.amount }),
      ...(body.taxAmount    !== undefined && { taxAmount:    body.taxAmount }),
      ...(body.issueDate    !== undefined && { issueDate:    new Date(body.issueDate) }),
      ...(body.dueDate      !== undefined && { dueDate:      new Date(body.dueDate) }),
      ...(body.note         !== undefined && { note:         body.note }),
    },
  });
  return NextResponse.json({ data: record });
}

// DELETE /api/payables/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.payable.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
