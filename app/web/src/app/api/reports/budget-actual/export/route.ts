import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { getBudgetActualReport } from "@/lib/budget-actual";
import type { ForecastMethod } from "@/lib/forecast";

// GET /api/reports/budget-actual/export … 予実対比レポートの CSV 出力
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

    const header = "period,budget,actual,forecast,variance,achievementRate";
    const lines = report.rows.map((r) =>
      [
        r.period,
        r.budget,
        r.actual ?? "",
        r.forecast ?? "",
        r.variance ?? "",
        r.achievementRate != null ? (r.achievementRate * 100).toFixed(1) + "%" : "",
      ].join(","),
    );
    const csv = [header, ...lines].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="budget-actual-${query.accountCode}-${year}.csv"`,
      },
    });
  },
});
