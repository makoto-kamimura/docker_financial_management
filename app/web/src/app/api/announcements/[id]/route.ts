import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

// DELETE /api/announcements/[id] … 決算公告の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.announcement.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.announcement.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
