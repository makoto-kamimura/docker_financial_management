import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const TaxSettingSchema = z.object({
  taxYear: z.number().int(),
  taxationType: z.string().min(1),
  simplifiedRate: z.number().nullable().optional(),
});

// GET /api/tax-settings?year= … 消費税設定（year 指定時は 1 件）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    if (query.year) {
      const setting = await db.taxSetting.findUnique({
        where: { tenantId_taxYear: { tenantId, taxYear: query.year } },
      });
      return NextResponse.json({ data: setting });
    }

    const settings = await db.taxSetting.findMany({
      where: { tenantId },
      orderBy: { taxYear: "desc" },
    });
    return NextResponse.json({ data: settings });
  },
});

// PUT /api/tax-settings … 消費税設定の登録・更新（年度単位 upsert、editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: TaxSettingSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;
    const setting = await db.taxSetting.upsert({
      where: { tenantId_taxYear: { tenantId, taxYear: body.taxYear } },
      update: { taxationType: body.taxationType, simplifiedRate: body.simplifiedRate ?? null },
      create: {
        tenantId,
        taxYear: body.taxYear,
        taxationType: body.taxationType,
        simplifiedRate: body.simplifiedRate ?? null,
      },
    });

    return NextResponse.json({ data: setting });
  },
});
