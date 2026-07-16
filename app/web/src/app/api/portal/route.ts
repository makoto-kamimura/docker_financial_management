import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

// GET /api/portal … 税理士ポータル（自テナントの財務サマリ、accountant 以上）
export const GET = withApi({
  role: "accountant",
  querySchema: z.object({ fiscalYear: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const fiscalYear = query.fiscalYear ?? new Date().getFullYear();

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
  },
});
