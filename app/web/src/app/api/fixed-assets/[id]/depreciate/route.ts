import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { resolvePeriod } from "@/lib/period";

// POST /api/fixed-assets/[id]/depreciate?year= … 年次償却の計上（editor 以上）
export const POST = withApi({
  role: "editor",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, id, query }) => {
    const { tenantId } = user;
    const fiscalYear = query.year ?? new Date().getFullYear();

    const asset = await db.fixedAsset.findUnique({ where: { id, tenantId } });
    if (!asset) throw notFound();
    if (asset.disposedOn) throw badRequest("disposed asset");

    const existing = await db.depreciation.findUnique({
      where: { fixedAssetId_fiscalYear: { fixedAssetId: asset.id, fiscalYear } },
    });
    if (existing) throw badRequest(`${fiscalYear}年度の償却は既に計上済みです`);

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

    const [depreciation] = await db.$transaction([
      db.depreciation.create({ data: { fixedAssetId: asset.id, fiscalYear, amount } }),
      db.fixedAsset.update({
        where: { id: asset.id },
        data: { bookValue: { decrement: amount } },
      }),
    ]);

    const deprAccount = await db.account.findFirst({ where: { tenantId, code: "H3400" } });
    if (deprAccount) {
      const period = await resolvePeriod(db, tenantId, fiscalYear, 12);
      await db.financialRecord.create({
        data: { tenantId, accountId: deprAccount.id, periodId: period.id, amount },
      });
    }

    return NextResponse.json({ data: depreciation }, { status: 201 });
  },
});
