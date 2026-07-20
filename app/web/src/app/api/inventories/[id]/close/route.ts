import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";

// D-5d-4: 棚卸資産科目。従来は "1200"（当座預金）を誤って参照しており、棚卸確定のたびに
// 棚卸資産ではなく当座預金の残高へ計上してしまう既存バグがあった（調査で判明・修正）。
const INVENTORY_ASSET_ACCOUNT_CODE = "1400"; // 棚卸資産
const COGS_ACCOUNT_CODE = "5000"; // 仕入高（棚卸確定仕訳の相手科目）

// POST /api/inventories/[id]/close … 棚卸の確定（棚卸資産科目へ実績連動、editor 以上）
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

    const stockAccount = await db.account.findFirst({
      where: { tenantId, code: INVENTORY_ASSET_ACCOUNT_CODE },
    });
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

      // D-5d-4: 監査証跡として複式仕訳（Dr 棚卸資産/Cr 仕入高）も記録する（相手科目が
      // 見つかる場合のみ）。choke-point 同期は呼ばない — 期末棚卸による売上原価の調整を
      // P/L（KPI・決算書・e-Tax）へ反映するかは別途の会計処理判断であり本タスクのスコープ外
      // （D-5d-2 と同じ方針。再設計タスク.md D-5d-4 の実装記録を参照）。
      const cogsAccount = await db.account.findFirst({
        where: { tenantId, code: COGS_ACCOUNT_CODE },
      });
      if (cogsAccount) {
        await db.journalEntry.create({
          data: {
            tenantId,
            transactionDate: inventory.inventoryDate,
            description: `棚卸確定（${inventory.name}）（自動仕訳）`,
            paymentMethod: "other",
            taxCategory: "non_taxable",
            details: {
              create: [
                {
                  side: "debit",
                  accountId: stockAccount.id,
                  amount: Number(inventory.totalAmount),
                },
                {
                  side: "credit",
                  accountId: cogsAccount.id,
                  amount: Number(inventory.totalAmount),
                },
              ],
            },
          },
        });
      }
    }

    const updated = await db.inventory.update({ where: { id }, data: { status: "closed" } });
    return NextResponse.json({ data: updated });
  },
});
