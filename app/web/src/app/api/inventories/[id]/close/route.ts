import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// POST /api/inventories/[id]/close — 棚卸確定（FinancialRecord 反映）
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const inventory = await prisma.inventory.findUnique({
    where: { id: Number(id) },
    include: { items: true },
  });
  if (!inventory) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inventory.status === "closed") {
    return NextResponse.json({ error: "already closed" }, { status: 400 });
  }

  // 棚卸資産勘定（コード: 1200）を FinancialRecord に反映
  const stockAccount = await prisma.account.findFirst({ where: { code: "1200" } });
  if (stockAccount) {
    const date = inventory.inventoryDate;
    const period = await prisma.period.upsert({
      where: { fiscalYear_month: { fiscalYear: date.getFullYear(), month: date.getMonth() + 1 } },
      update: {},
      create: {
        fiscalYear: date.getFullYear(),
        month: date.getMonth() + 1,
        quarter: Math.ceil((date.getMonth() + 1) / 3),
      },
    });
    await prisma.financialRecord.create({
      data: { accountId: stockAccount.id, periodId: period.id, amount: inventory.totalAmount },
    });
  }

  const updated = await prisma.inventory.update({
    where: { id: Number(id) },
    data: { status: "closed" },
  });
  return NextResponse.json({ data: updated });
}
