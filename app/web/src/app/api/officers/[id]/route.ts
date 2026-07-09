import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.officer.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { name?: string; title?: string; termStart?: string; termEnd?: string; salary?: number };
  const officer = await db.officer.update({
    where: { id: Number(id) },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.title && { title: body.title }),
      ...(body.termStart && { termStart: new Date(body.termStart) }),
      ...(body.termEnd && { termEnd: new Date(body.termEnd) }),
      salary: body.salary ?? undefined,
    },
  });
  return NextResponse.json({ data: officer });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.officer.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.officer.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
