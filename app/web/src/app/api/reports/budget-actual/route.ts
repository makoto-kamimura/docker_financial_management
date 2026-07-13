import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { getBudgetActualReport } from "@/lib/budget-actual";
import type { ForecastMethod } from "@/lib/forecast";

// GET /api/reports/budget-actual?accountCode=&year=&method= … 予実対比レポート
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    accountCode: z.string().default("4000"),
    year: z.coerce.number().int().optional(),
    method: z.string().default("linear_regression"),
  }),
  handler: async ({ user, db, query }) => {
    const year = query.year ?? new Date().getFullYear();
    const method = query.method as ForecastMethod;

    const report = await getBudgetActualReport(db, user.tenantId, query.accountCode, year, method);
    return NextResponse.json({ accountCode: query.accountCode, year, method, ...report });
  },
});
