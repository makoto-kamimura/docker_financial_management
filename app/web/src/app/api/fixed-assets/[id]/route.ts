import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// GET /api/fixed-assets/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const asset = await prisma.fixedAsset.findUnique({
    where: { id: Number(id) },
    include: { depreciations: { orderBy: { fiscalYear: "asc" } } },
  });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: asset });
}

// PUT /api/fixed-assets/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json() as Partial<{
    name: string; category: string; disposedOn: string | null;
  }>;

  const asset = await prisma.fixedAsset.update({
    where: { id: Number(id) },
    data: {
      ...(body.name     !== undefined && { name: body.name }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.disposedOn !== undefined && { disposedOn: body.disposedOn ? new Date(body.disposedOn) : null }),
    },
  });
  return NextResponse.json({ data: asset });
}

// DELETE /api/fixed-assets/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.fixedAsset.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
