import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

// GET /api/portal
// Returns financial summary for the current user's tenant.
export async function GET(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const sp = req.nextUrl.searchParams;
  const fiscalYear = Number(sp.get("fiscalYear") ?? new Date().getFullYear());

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

  const records = await db.financialRecord.findMany({
    where: { tenantId, period: { fiscalYear } },
    include: { account: true },
  });

  const totals: Record<string, number> = {};
  for (const r of records) {
    const cat = r.account.category;
    totals[cat] = (totals[cat] ?? 0) + Number(r.amount);
  }

  const revenue = totals["REVENUE"] ?? 0;
  const expense = totals["EXPENSE"] ?? 0;
  const cogs = totals["COGS"] ?? 0;
  const netIncome = revenue - cogs - expense;

  const closeStatus = await db.fiscalYearClose.findUnique({
    where: { tenantId_fiscalYear: { tenantId, fiscalYear } },
  });

  const pendingApprovals = await db.journalApproval.count({
    where: { action: "submitted", journalEntry: { tenantId } },
  });

  return NextResponse.json({
    fiscalYear,
    tenants: [
      {
        tenantId,
        tenantName: tenant?.name ?? "",
        fiscalYear,
        revenue,
        expense: cogs + expense,
        netIncome,
        closeStatus: closeStatus?.status ?? "OPEN",
        pendingApprovals,
      },
    ],
  });
}
