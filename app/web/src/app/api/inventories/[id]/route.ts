import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// GET /api/inventories/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const inventory = await prisma.inventory.findUnique({
    where: { id: Number(id) },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!inventory) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: inventory });
}

// DELETE /api/inventories/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.inventory.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
