import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { invalidateCache } from "@/lib/redis";

const FinalizeSchema = z.object({
  fiscalYear: z.number().int(),
  netIncome: z.number(),
});

// POST /api/closing/finalize … 決算確定（キャッシュ無効化、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: FinalizeSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const existing = await db.fiscalYearClose.findUnique({
      where: { tenantId_fiscalYear: { tenantId, fiscalYear: body.fiscalYear } },
    });
    if (existing?.status === "closed") {
      throw badRequest(`${body.fiscalYear}年度は既に決算確定済みです`);
    }

    const close = await db.fiscalYearClose.upsert({
      where: { tenantId_fiscalYear: { tenantId, fiscalYear: body.fiscalYear } },
      update: { status: "closed", closedAt: new Date(), netIncome: body.netIncome },
      create: {
        tenantId,
        fiscalYear: body.fiscalYear,
        status: "closed",
        closedAt: new Date(),
        netIncome: body.netIncome,
      },
    });

    await invalidateCache(`closing:statements:${tenantId}:${body.fiscalYear}`);
    await invalidateCache(`reports:ledger:${tenantId}:${body.fiscalYear}:*`);

    return NextResponse.json({ data: close });
  },
});

// DELETE /api/closing/finalize?year= … 決算締め解除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ year: z.coerce.number().int() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const close = await db.fiscalYearClose.upsert({
      where: { tenantId_fiscalYear: { tenantId, fiscalYear: query.year } },
      update: { status: "open", closedAt: null },
      create: { tenantId, fiscalYear: query.year, status: "open" },
    });
    return NextResponse.json({ data: close });
  },
});
