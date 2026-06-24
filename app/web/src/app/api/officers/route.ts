import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const officers = await prisma.officer.findMany({
    where: tenantId ? { tenantId: Number(tenantId) } : undefined,
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { termStart: "asc" },
  });
  return NextResponse.json({ data: officers });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const body = await req.json() as {
    tenantId: number; name: string; title: string;
    termStart: string; termEnd: string; salary?: number;
  };
  if (!body.tenantId || !body.name || !body.title || !body.termStart || !body.termEnd) {
    return NextResponse.json({ error: "tenantId, name, title, termStart, termEnd are required" }, { status: 400 });
  }
  const officer = await prisma.officer.create({
    data: {
      tenantId: body.tenantId,
      name: body.name,
      title: body.title,
      termStart: new Date(body.termStart),
      termEnd: new Date(body.termEnd),
      salary: body.salary ?? null,
    },
  });
  return NextResponse.json({ data: officer }, { status: 201 });
}
