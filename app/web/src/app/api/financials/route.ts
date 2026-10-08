import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { DIRECT_ACTUALS_GONE_MESSAGE, gone } from "@/lib/api-error";
import { aggregate, type Granularity, type RecordWithPeriod } from "@/lib/aggregate";
import { ACTUAL_WHERE } from "@/lib/actuals";

// GET /api/financials?granularity=month&accountCode=4000
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    granularity: z.enum(["month", "quarter", "year"]).default("month"),
    accountCode: z.string().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const granularity = query.granularity as Granularity;

    const records = await db.financialRecord.findMany({
      where: {
        tenantId,
        ...ACTUAL_WHERE,
        ...(query.accountCode ? { account: { code: query.accountCode } } : {}),
      },
      include: { period: true },
    });

    const mapped: RecordWithPeriod[] = records.map((r) => ({
      amount: Number(r.amount),
      fiscalYear: r.period.fiscalYear,
      quarter: r.period.quarter,
      month: r.period.month,
    }));

    return NextResponse.json({ granularity, data: aggregate(mapped, granularity) });
  },
});

// POST /api/financials … 実績データの登録（科目×月への手入力）。
// 実績は明細（現金・銀行・カード）に科目を付けると入るようにしたため、直接の登録はやめた（410）。
export const POST = withApi({
  role: "editor",
  handler: async () => {
    throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
  },
});
