import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const AnnouncementSchema = z.object({
  announcementDate: zDate,
  method: z.string().default("WEBSITE"),
  content: z.string().optional(),
  fiscalYear: z.number().int(),
});

// GET /api/announcements … 決算公告一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const announcements = await db.announcement.findMany({
      where: { tenantId: user.tenantId },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { announcementDate: "desc" },
    });
    return NextResponse.json({ data: announcements });
  },
});

// POST /api/announcements … 決算公告の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: AnnouncementSchema,
  handler: async ({ user, db, body }) => {
    const ann = await db.announcement.create({
      data: {
        tenantId: user.tenantId,
        announcementDate: body.announcementDate,
        method: body.method,
        content: body.content ?? null,
        fiscalYear: body.fiscalYear,
      },
    });
    return NextResponse.json({ data: ann }, { status: 201 });
  },
});
