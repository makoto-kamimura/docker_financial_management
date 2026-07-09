import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { categoryBucket } from "@/lib/kpi";
import { buildCashFlow, type SysMode } from "@/lib/cashflow";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const yearParam = req.nextUrl.searchParams.get("year");
  const modeParam = req.nextUrl.searchParams.get("mode") as SysMode | null;
  const year = yearParam ? Number(yearParam) : undefined;
  const mode: SysMode =
    modeParam && ["household", "sole", "corporate"].includes(modeParam) ? modeParam : "sole";

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
}
