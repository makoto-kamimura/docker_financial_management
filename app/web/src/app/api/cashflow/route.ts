import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { categoryBucket } from "@/lib/kpi";
import { buildCashFlow, type SysMode } from "@/lib/cashflow";

// GET /api/cashflow?year=&mode= … 年間資金フロー図（集計ベース）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    mode: z.enum(["household", "sole", "corporate"]).default("sole"),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year } = query;
    const mode = query.mode as SysMode;

    const records = await db.financialRecord.findMany({
      where: { tenantId, ...(year ? { period: { fiscalYear: year } } : {}) },
      include: { account: true },
    });

    const totals = { revenue: 0, cogs: 0, expense: 0 };
    for (const r of records) {
      const bucket = categoryBucket(r.account.category);
      if (bucket) totals[bucket] += Number(r.amount);
    }

    const { graph, grossProfit, operatingProfit, labels } = buildCashFlow(totals, mode);

    return NextResponse.json({
      year: year ?? "all",
      totals: { ...totals, grossProfit, operatingProfit },
      labels,
      graph,
    });
  },
});
