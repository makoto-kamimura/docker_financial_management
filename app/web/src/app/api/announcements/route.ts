import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const announcements = await prisma.announcement.findMany({
    where: tenantId ? { tenantId: Number(tenantId) } : undefined,
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { announcementDate: "desc" },
  });
  return NextResponse.json({ data: announcements });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const body = (await req.json()) as {
    tenantId: number;
    announcementDate: string;
    method?: string;
    content?: string;
    fiscalYear: number;
  };
  if (!body.tenantId || !body.announcementDate || !body.fiscalYear) {
    return NextResponse.json(
      { error: "tenantId, announcementDate, fiscalYear are required" },
      { status: 400 },
    );
  }
  const ann = await prisma.announcement.create({
    data: {
      tenantId: body.tenantId,
      announcementDate: new Date(body.announcementDate),
      method: body.method ?? "WEBSITE",
      content: body.content ?? null,
      fiscalYear: body.fiscalYear,
    },
  });
  return NextResponse.json({ data: ann }, { status: 201 });
}
