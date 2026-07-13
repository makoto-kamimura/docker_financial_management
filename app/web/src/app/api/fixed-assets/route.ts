import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const FixedAssetSchema = z.object({
  name: z.string().min(1),
  category: z.string().default("tangible"),
  acquiredOn: zDate,
  acquisitionCost: z.number().positive(),
  usefulLife: z.number().int().positive(),
  method: z.string().default("straight"),
  residualRate: z.number().default(0.1),
});

// GET /api/fixed-assets … 固定資産一覧（償却履歴付き）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const assets = await db.fixedAsset.findMany({
      where: { tenantId: user.tenantId },
      include: { depreciations: { orderBy: { fiscalYear: "asc" } } },
      orderBy: { acquiredOn: "desc" },
    });
    return NextResponse.json({ data: assets });
  },
});

// POST /api/fixed-assets … 固定資産の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: FixedAssetSchema,
  handler: async ({ user, db, body }) => {
    const asset = await db.fixedAsset.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        category: body.category,
        acquiredOn: body.acquiredOn,
        acquisitionCost: body.acquisitionCost,
        usefulLife: body.usefulLife,
        method: body.method,
        residualRate: body.residualRate,
        bookValue: body.acquisitionCost,
      },
    });
    return NextResponse.json({ data: asset }, { status: 201 });
  },
});
