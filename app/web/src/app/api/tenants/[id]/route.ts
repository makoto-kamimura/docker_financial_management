import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { id: Number(id) } });
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: tenant });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json() as {
    type?: string; name?: string; corporateNumber?: string;
    capitalAmount?: number; establishedOn?: string; closingMonth?: number;
  };
  const tenant = await prisma.tenant.update({
    where: { id: Number(id) },
    data: {
      ...(body.type && { type: body.type }),
      ...(body.name && { name: body.name }),
      corporateNumber: body.corporateNumber ?? undefined,
      capitalAmount: body.capitalAmount ?? undefined,
      establishedOn: body.establishedOn ? new Date(body.establishedOn) : undefined,
      ...(body.closingMonth !== undefined && { closingMonth: body.closingMonth }),
    },
  });
  return NextResponse.json({ data: tenant });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;
  const { id } = await params;
  await prisma.tenant.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
