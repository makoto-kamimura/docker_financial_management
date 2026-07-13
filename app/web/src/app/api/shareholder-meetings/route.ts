import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const MeetingSchema = z.object({
  meetingDate: zDate,
  meetingType: z.string().default("regular"),
  agenda: z.string().min(1),
  resolution: z.string().optional(),
});

// GET /api/shareholder-meetings … 株主総会一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const meetings = await db.shareholderMeeting.findMany({
      where: { tenantId: user.tenantId },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { meetingDate: "desc" },
    });
    return NextResponse.json({ data: meetings });
  },
});

// POST /api/shareholder-meetings … 株主総会の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: MeetingSchema,
  handler: async ({ user, db, body }) => {
    const meeting = await db.shareholderMeeting.create({
      data: {
        tenantId: user.tenantId,
        meetingDate: body.meetingDate,
        meetingType: body.meetingType,
        agenda: body.agenda,
        resolution: body.resolution ?? null,
      },
    });
    return NextResponse.json({ data: meeting }, { status: 201 });
  },
});
