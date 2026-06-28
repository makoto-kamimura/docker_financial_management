import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/portal
// accountant ロール以上が全テナント横断で財務サマリを取得するエンドポイント。
// ?fiscalYear=2025
export async function GET(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const fiscalYear = Number(sp.get("fiscalYear") ?? new Date().getFullYear());

  const tenants = await prisma.tenant.findMany({ orderBy: { name: "asc" } });

  const results = await Promise.all(
    tenants.map(async (tenant) => {
      const records = await prisma.financialRecord.findMany({
        where: { period: { fiscalYear } },
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

      const closeStatus = await prisma.fiscalYearClose.findFirst({
        where: { fiscalYear },
        orderBy: { createdAt: "desc" },
      });

      // action: submitted = 承認待ち
      const pendingApprovals = await prisma.journalApproval.count({
        where: { action: "submitted" },
      });

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        fiscalYear,
        revenue,
        expense: cogs + expense,
        netIncome,
        closeStatus: closeStatus?.status ?? "OPEN",
        pendingApprovals,
      };
    }),
  );

  return NextResponse.json({ fiscalYear, tenants: results });
}
