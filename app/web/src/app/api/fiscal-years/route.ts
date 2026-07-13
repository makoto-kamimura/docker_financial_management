import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const FiscalYearSchema = z.object({
  year: z.number().int(),
  startDate: zDate,
  endDate: zDate,
});

// GET /api/fiscal-years … 会計年度一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const fiscalYears = await db.fiscalYear.findMany({
      where: { tenantId: user.tenantId },
      include: { tenant: true },
      orderBy: { year: "desc" },
    });
    return NextResponse.json({ data: fiscalYears });
  },
});

// POST /api/fiscal-years … 会計年度の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: FiscalYearSchema,
  handler: async ({ user, db, body }) => {
    const fy = await db.fiscalYear.create({
      data: {
        tenantId: user.tenantId,
        year: body.year,
        startDate: body.startDate,
        endDate: body.endDate,
      },
      include: { tenant: true },
    });
    return NextResponse.json({ data: fy }, { status: 201 });
  },
});
