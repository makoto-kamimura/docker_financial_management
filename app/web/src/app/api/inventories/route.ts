import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const InventorySchema = z.object({
  name: z.string().min(1),
  inventoryDate: zDate,
  valuationMethod: z.string().default("last_purchase"),
  items: z
    .array(
      z.object({
        itemName: z.string().min(1),
        itemType: z.string().default("product"),
        quantity: z.number(),
        unit: z.string().default("個"),
        unitPrice: z.number(),
      }),
    )
    .optional(),
});

// GET /api/inventories?year= … 棚卸一覧
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const dateFilter = query.year
      ? {
          inventoryDate: {
            gte: new Date(`${query.year}-01-01`),
            lt: new Date(`${query.year + 1}-01-01`),
          },
        }
      : {};

    const inventories = await db.inventory.findMany({
      where: { tenantId: user.tenantId, ...dateFilter },
      include: { items: true },
      orderBy: { inventoryDate: "desc" },
    });
    return NextResponse.json({ data: inventories });
  },
});

// POST /api/inventories … 棚卸の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: InventorySchema,
  handler: async ({ user, db, body }) => {
    const items = (body.items ?? []).map((i) => ({
      itemName: i.itemName,
      itemType: i.itemType,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      totalAmount: i.quantity * i.unitPrice,
    }));

    const totalAmount = items.reduce((s, i) => s + Number(i.totalAmount), 0);

    const inventory = await db.inventory.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        inventoryDate: body.inventoryDate,
        valuationMethod: body.valuationMethod,
        totalAmount,
        items: items.length > 0 ? { create: items } : undefined,
      },
      include: { items: true },
    });
    return NextResponse.json({ data: inventory }, { status: 201 });
  },
});
