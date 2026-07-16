import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { JOURNAL_DETAILS_INCLUDE } from "@/lib/journal";

// GET /api/journals/[id] … 仕訳 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const entry = await db.journalEntry.findUnique({
      where: { id, tenantId: user.tenantId },
      include: JOURNAL_DETAILS_INCLUDE,
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
