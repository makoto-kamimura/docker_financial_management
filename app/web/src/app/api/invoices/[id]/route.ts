import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id: Number(id) },
    include: { lines: true },
  });
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: invoice });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as { status?: string; note?: string };
  const invoice = await prisma.invoice.update({
    where: { id: Number(id) },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.note !== undefined && { note: body.note }),
    },
    include: { lines: true },
  });
  return NextResponse.json({ data: invoice });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const { id } = await params;
  await prisma.invoice.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
