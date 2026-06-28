import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const INCLUDE = {
  lines: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const { id } = await params;
  const t = await prisma.journalTemplate.findUnique({
    where: { id: Number(id) },
    include: INCLUDE,
  });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ data: t });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    lines?: {
      side: string;
      accountId: number;
      amount?: number;
      note?: string;
      sortOrder?: number;
    }[];
  };

  await prisma.$transaction(async (tx) => {
    await tx.journalTemplate.update({
      where: { id: Number(id) },
      data: { ...(body.name && { name: body.name }), description: body.description ?? undefined },
    });
    if (body.lines) {
      await tx.journalTemplateLine.deleteMany({ where: { templateId: Number(id) } });
      await tx.journalTemplateLine.createMany({
        data: body.lines.map((l, i) => ({
          templateId: Number(id),
          side: l.side,
          accountId: l.accountId,
          amount: l.amount ?? null,
          note: l.note ?? null,
          sortOrder: l.sortOrder ?? i,
        })),
      });
    }
  });

  const updated = await prisma.journalTemplate.findUnique({
    where: { id: Number(id) },
    include: INCLUDE,
  });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const { id } = await params;
  await prisma.journalTemplate.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
