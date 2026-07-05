import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const existing = await prisma.fiscalYear.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { status?: string; endDate?: string };
  const fy = await prisma.fiscalYear.update({
    where: { id: Number(id) },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.endDate && { endDate: new Date(body.endDate) }),
    },
  });
  return NextResponse.json({ data: fy });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const existing = await prisma.fiscalYear.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.fiscalYear.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
