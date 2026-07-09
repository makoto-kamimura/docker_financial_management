import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.announcement.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.announcement.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
