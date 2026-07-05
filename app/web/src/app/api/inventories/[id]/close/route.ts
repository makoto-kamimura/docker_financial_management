import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const inventory = await prisma.inventory.findUnique({
    where: { id: Number(id), tenantId },
    include: { items: true },
  });
  if (!inventory) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inventory.status === "closed") return NextResponse.json({ error: "already closed" }, { status: 400 });

  const stockAccount = await prisma.account.findFirst({ where: { tenantId, code: "1200" } });
  if (stockAccount) {
    const date = inventory.inventoryDate;
    const fiscalYear = date.getFullYear();
    const month = date.getMonth() + 1;
    const period = await prisma.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
      update: {},
      create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
    });
    await prisma.financialRecord.create({
      data: { tenantId, accountId: stockAccount.id, periodId: period.id, amount: inventory.totalAmount },
    });
  }

  const updated = await prisma.inventory.update({ where: { id: Number(id) }, data: { status: "closed" } });
  return NextResponse.json({ data: updated });
}
