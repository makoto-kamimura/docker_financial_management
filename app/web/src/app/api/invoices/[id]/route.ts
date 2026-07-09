import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const invoice = await db.invoice.findUnique({
    where: { id: Number(id), tenantId },
    include: { lines: true },
  });
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: invoice });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.invoice.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { status?: string; note?: string };
  const invoice = await db.invoice.update({
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
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.invoice.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.invoice.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
