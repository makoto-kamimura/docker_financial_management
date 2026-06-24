import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const INCLUDE = {
  lines: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const templates = await prisma.journalTemplate.findMany({ include: INCLUDE, orderBy: { id: "asc" } });
  return NextResponse.json({ data: templates });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = await req.json() as {
    name: string; description?: string;
    lines: { side: string; accountId: number; amount?: number; note?: string; sortOrder?: number }[];
  };
  if (!body.name || !body.lines?.length) {
    return NextResponse.json({ error: "name and lines are required" }, { status: 400 });
  }

  const template = await prisma.journalTemplate.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      lines: {
        create: body.lines.map((l, i) => ({
          side: l.side,
          accountId: l.accountId,
          amount: l.amount ?? null,
          note: l.note ?? null,
          sortOrder: l.sortOrder ?? i,
        })),
      },
    },
    include: INCLUDE,
  });
  return NextResponse.json({ data: template }, { status: 201 });
}
