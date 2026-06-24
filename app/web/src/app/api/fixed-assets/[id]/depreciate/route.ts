import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// POST /api/fixed-assets/[id]/depreciate?year=2026
// 年間減価償却費を計算して記録し、帳簿価額を更新
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const yearParam = req.nextUrl.searchParams.get("year");
  const fiscalYear = yearParam ? Number(yearParam) : new Date().getFullYear();

  const asset = await prisma.fixedAsset.findUnique({ where: { id: Number(id) } });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (asset.disposedOn) return NextResponse.json({ error: "disposed asset" }, { status: 400 });

  const existing = await prisma.depreciation.findUnique({
    where: { fixedAssetId_fiscalYear: { fixedAssetId: asset.id, fiscalYear } },
  });
  if (existing) return NextResponse.json({ error: `${fiscalYear}年度の償却は既に計上済みです` }, { status: 400 });

  const cost        = Number(asset.acquisitionCost);
  const bookValue   = Number(asset.bookValue);
  const usefulLife  = asset.usefulLife;

  let amount: number;
  if (asset.method === "straight") {
    // 定額法: 取得価額 × (1 - 残存率) ÷ 耐用年数
    const residual = cost * Number(asset.residualRate);
    amount = Math.floor((cost - residual) / usefulLife);
  } else {
    // 定率法: 帳簿価額 × (1 ÷ 耐用年数 × 2)
    const rate = (1 / usefulLife) * 2;
    amount = Math.floor(bookValue * rate);
  }

  // 帳簿価額が0以下なら償却しない
  amount = Math.min(amount, Math.max(bookValue - 1, 0));

  const [depreciation] = await prisma.$transaction([
    prisma.depreciation.create({
      data: { fixedAssetId: asset.id, fiscalYear, amount },
    }),
    prisma.fixedAsset.update({
      where: { id: asset.id },
      data:  { bookValue: { decrement: amount } },
    }),
  ]);

  // 減価償却費勘定（コード: H3400）に FinancialRecord 反映
  const deprAccount = await prisma.account.findFirst({ where: { code: "H3400" } });
  if (deprAccount) {
    const period = await prisma.period.upsert({
      where:  { fiscalYear_month: { fiscalYear, month: 12 } },
      update: {},
      create: { fiscalYear, month: 12, quarter: 4 },
    });
    await prisma.financialRecord.create({
      data: { accountId: deprAccount.id, periodId: period.id, amount },
    });
  }

  return NextResponse.json({ data: depreciation }, { status: 201 });
}
