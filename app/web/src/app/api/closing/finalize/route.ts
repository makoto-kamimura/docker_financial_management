import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { invalidateCache } from "@/lib/redis";

const FinalizeSchema = z.object({
  fiscalYear: z.number().int(),
  netIncome: z.number(),
});

// D-2: 会計年度の締め状態は FiscalYear（旧 FiscalYearClose を統合）で一元管理する。
// fiscalYear は Period.fiscalYear と同じ「暦年」整数。/fiscal-years で事前登録されていない
// 年度を確定した場合は、暦年（1/1〜12/31）で FiscalYear 行を自動作成する。
function calendarYearRange(year: number) {
  return { startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) };
}

// POST /api/closing/finalize … 決算確定（キャッシュ無効化、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: FinalizeSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const existing = await db.fiscalYear.findUnique({
      where: { tenantId_year: { tenantId, year: body.fiscalYear } },
    });
    if (existing?.status === "closed") {
      throw badRequest(`${body.fiscalYear}年度は既に決算確定済みです`);
    }

    const close = existing
      ? await db.fiscalYear.update({
          where: { id: existing.id },
          data: { status: "closed", closedAt: new Date(), netIncome: body.netIncome },
        })
      : await db.fiscalYear.create({
          data: {
            tenantId,
            year: body.fiscalYear,
            ...calendarYearRange(body.fiscalYear),
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
    const existing = await db.fiscalYear.findUnique({
      where: { tenantId_year: { tenantId, year: query.year } },
    });
    const close = existing
      ? await db.fiscalYear.update({
          where: { id: existing.id },
          data: { status: "open", closedAt: null },
        })
      : await db.fiscalYear.create({
          data: { tenantId, year: query.year, ...calendarYearRange(query.year), status: "open" },
        });
    return NextResponse.json({ data: close });
  },
});
