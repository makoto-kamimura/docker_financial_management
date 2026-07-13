import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

// GET /api/inventories/[id] … 棚卸 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const inventory = await db.inventory.findUnique({
      where: { id, tenantId: user.tenantId },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!inventory) throw notFound();
    return NextResponse.json({ data: inventory });
  },
});

// DELETE /api/inventories/[id] … 棚卸の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.inventory.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.inventory.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
