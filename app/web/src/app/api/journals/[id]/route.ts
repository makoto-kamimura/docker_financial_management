import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

const INCLUDE_DETAILS = {
  details: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { side: "asc" as const },
  },
};

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const entry = await db.journalEntry.findUnique({
    where: { id: Number(id), tenantId },
    include: INCLUDE_DETAILS,
  });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: entry });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const entry = await db.journalEntry.findUnique({ where: { id: Number(id), tenantId } });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.journalEntry.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
