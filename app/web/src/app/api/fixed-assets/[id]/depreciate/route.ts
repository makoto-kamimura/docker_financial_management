import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const yearParam = req.nextUrl.searchParams.get("year");
  const fiscalYear = yearParam ? Number(yearParam) : new Date().getFullYear();

  const asset = await prisma.fixedAsset.findUnique({ where: { id: Number(id), tenantId } });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (asset.disposedOn) return NextResponse.json({ error: "disposed asset" }, { status: 400 });

  const existing = await prisma.depreciation.findUnique({
    where: { fixedAssetId_fiscalYear: { fixedAssetId: asset.id, fiscalYear } },
  });
  if (existing) return NextResponse.json({ error: `${fiscalYear}年度の償却は既に計上済みです` }, { status: 400 });

  const cost = Number(asset.acquisitionCost);
  const bookValue = Number(asset.bookValue);
  const usefulLife = asset.usefulLife;

  let amount: number;
  if (asset.method === "straight") {
    const residual = cost * Number(asset.residualRate);
    amount = Math.floor((cost - residual) / usefulLife);
  } else {
    const rate = (1 / usefulLife) * 2;
    amount = Math.floor(bookValue * rate);
  }
  amount = Math.min(amount, Math.max(bookValue - 1, 0));

  const [depreciation] = await prisma.$transaction([
    prisma.depreciation.create({ data: { fixedAssetId: asset.id, fiscalYear, amount } }),
    prisma.fixedAsset.update({ where: { id: asset.id }, data: { bookValue: { decrement: amount } } }),
  ]);

  const deprAccount = await prisma.account.findFirst({ where: { tenantId, code: "H3400" } });
  if (deprAccount) {
    const period = await prisma.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month: 12 } },
      update: {},
      create: { tenantId, fiscalYear, month: 12, quarter: 4 },
    });
    await prisma.financialRecord.create({
      data: { tenantId, accountId: deprAccount.id, periodId: period.id, amount },
    });
  }

  return NextResponse.json({ data: depreciation }, { status: 201 });
}
