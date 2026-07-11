import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

const CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.personalAsset.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as Partial<{
    name: string;
    category: string;
    acquiredOn: string | null;
    acquisitionCost: number | null;
    currentValue: number;
    note: string | null;
  }>;
  if (body.category && !CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: `invalid category: ${body.category}` }, { status: 400 });
  }

  const asset = await db.personalAsset.update({
    where: { id: Number(id) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.category !== undefined && { category: body.category as (typeof CATEGORIES)[number] }),
      ...(body.acquiredOn !== undefined && {
        acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
      }),
      ...(body.acquisitionCost !== undefined && { acquisitionCost: body.acquisitionCost }),
      ...(body.currentValue !== undefined && { currentValue: body.currentValue }),
      ...(body.note !== undefined && { note: body.note }),
    },
  });
  return NextResponse.json({ data: asset });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.personalAsset.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.personalAsset.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
