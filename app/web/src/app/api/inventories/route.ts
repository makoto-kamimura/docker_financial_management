import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/inventories?year=2026
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const year = req.nextUrl.searchParams.get("year");
  const where = year ? {
    inventoryDate: {
      gte: new Date(`${year}-01-01`),
      lt:  new Date(`${Number(year) + 1}-01-01`),
    },
  } : {};

  const inventories = await prisma.inventory.findMany({
    where,
    include: { items: true },
    orderBy: { inventoryDate: "desc" },
  });
  return NextResponse.json({ data: inventories });
}

// POST /api/inventories
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = await req.json() as {
    name:             string;
    inventoryDate:    string;
    valuationMethod?: string;
    items?: {
      itemName:  string;
      itemType?: string;
      quantity:  number;
      unit?:     string;
      unitPrice: number;
    }[];
  };

  if (!body.name || !body.inventoryDate) {
    return NextResponse.json({ error: "name and inventoryDate are required" }, { status: 400 });
  }

  const items = (body.items ?? []).map(i => ({
    itemName:    i.itemName,
    itemType:    i.itemType ?? "product",
    quantity:    i.quantity,
    unit:        i.unit ?? "個",
    unitPrice:   i.unitPrice,
    totalAmount: i.quantity * i.unitPrice,
  }));

  const totalAmount = items.reduce((s, i) => s + Number(i.totalAmount), 0);

  const inventory = await prisma.inventory.create({
    data: {
      name:            body.name,
      inventoryDate:   new Date(body.inventoryDate),
      valuationMethod: body.valuationMethod ?? "last_purchase",
      totalAmount,
      items: items.length > 0 ? { create: items } : undefined,
    },
    include: { items: true },
  });
  return NextResponse.json({ data: inventory }, { status: 201 });
}
