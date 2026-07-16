import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

// DELETE /api/dividends/[id] … 配当の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.dividend.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.dividend.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
