import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const INCLUDE_DETAILS = {
  details: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { side: "asc" as const },
  },
};

// GET /api/journals/[id] … 仕訳 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const entry = await db.journalEntry.findUnique({
      where: { id, tenantId: user.tenantId },
      include: INCLUDE_DETAILS,
    });
    if (!entry) throw notFound();
    return NextResponse.json({ data: entry });
  },
});

// DELETE /api/journals/[id] … 仕訳の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const entry = await db.journalEntry.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!entry) throw notFound();

    await db.journalEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
