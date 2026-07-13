import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";

// POST /api/inventories/[id]/close … 棚卸の確定（棚卸資産科目 1200 へ実績連動、editor 以上）
export const POST = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const { tenantId } = user;
    const inventory = await db.inventory.findUnique({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!inventory) throw notFound();
    if (inventory.status === "closed") throw badRequest("already closed");

    const stockAccount = await db.account.findFirst({ where: { tenantId, code: "1200" } });
    if (stockAccount) {
      const period = await resolvePeriodForDate(db, tenantId, inventory.inventoryDate);
      await db.financialRecord.create({
        data: {
          tenantId,
          accountId: stockAccount.id,
          periodId: period.id,
          amount: inventory.totalAmount,
        },
      });
    }

    const updated = await db.inventory.update({ where: { id }, data: { status: "closed" } });
    return NextResponse.json({ data: updated });
  },
});
