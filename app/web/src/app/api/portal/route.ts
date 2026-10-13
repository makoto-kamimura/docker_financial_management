import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { actualRows } from "@/lib/ledger/actuals";
import { actualWhere, scopedAmount, ScopeQuery } from "@/lib/ledger/scope";

// GET /api/portal … 税理士ポータル（自テナントの財務サマリ、accountant 以上）。
//   scope=business（個人事業主モード）は事業の分の実績だけ
export const GET = withApi({
  role: "accountant",
  querySchema: ScopeQuery.extend({ fiscalYear: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const fiscalYear = query.fiscalYear ?? new Date().getFullYear();

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

    const records = actualRows(
      await db.financialRecord.findMany({
        where: { tenantId, ...actualWhere(query.scope), period: { fiscalYear } },
        include: { account: true },
      }),
    );

    const totals: Record<string, number> = {};
    for (const r of records) {
      const cat = r.account.category;
      totals[cat] = (totals[cat] ?? 0) + scopedAmount(r, query.scope);
    }

    const revenue = totals["REVENUE"] ?? 0;
    const expense = totals["EXPENSE"] ?? 0;
    const cogs = totals["COGS"] ?? 0;
    const netIncome = revenue - cogs - expense;

    // D-2: 締め状態は FiscalYear（旧 FiscalYearClose を統合）で管理する
    const closeStatus = await db.fiscalYear.findUnique({
      where: { tenantId_year: { tenantId, year: fiscalYear } },
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
