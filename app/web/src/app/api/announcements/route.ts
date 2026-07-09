import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const announcements = await db.announcement.findMany({
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
  const db = tenantDb(tenantId);
  const body = (await req.json()) as { announcementDate: string; method?: string; content?: string; fiscalYear: number };
  if (!body.announcementDate || !body.fiscalYear) {
    return NextResponse.json({ error: "announcementDate, fiscalYear are required" }, { status: 400 });
  }

  const ann = await db.announcement.create({
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
