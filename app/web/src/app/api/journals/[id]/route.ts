import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

const INCLUDE_DETAILS = {
  details: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { side: "asc" as const },
  },
};

// GET /api/journals/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({
    where:   { id: Number(id) },
    include: INCLUDE_DETAILS,
  });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: entry });
}

// DELETE /api/journals/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  await prisma.journalEntry.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
