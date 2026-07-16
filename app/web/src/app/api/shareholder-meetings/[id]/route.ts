import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

const UpdateSchema = z.object({
  meetingDate: zDate.optional(),
  agenda: z.string().min(1).optional(),
  resolution: z.string().optional(),
});

// PUT /api/shareholder-meetings/[id] … 株主総会の更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.shareholderMeeting.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    const m = await db.shareholderMeeting.update({
      where: { id },
      data: {
        ...(body.meetingDate && { meetingDate: body.meetingDate }),
        ...(body.agenda && { agenda: body.agenda }),
        resolution: body.resolution ?? undefined,
      },
    });
    return NextResponse.json({ data: m });
  },
});

// DELETE /api/shareholder-meetings/[id] … 株主総会の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.shareholderMeeting.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    await db.shareholderMeeting.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
