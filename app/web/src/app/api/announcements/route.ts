import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const announcements = await prisma.announcement.findMany({
    where: { tenantId },
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { announcementDate: "desc" },
  });
  return NextResponse.json({ data: announcements });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as { announcementDate: string; method?: string; content?: string; fiscalYear: number };
  if (!body.announcementDate || !body.fiscalYear) {
    return NextResponse.json({ error: "announcementDate, fiscalYear are required" }, { status: 400 });
  }

  const ann = await prisma.announcement.create({
    data: {
      tenantId,
      announcementDate: new Date(body.announcementDate),
      method: body.method ?? "WEBSITE",
      content: body.content ?? null,
      fiscalYear: body.fiscalYear,
    },
  });
  return NextResponse.json({ data: ann }, { status: 201 });
}
