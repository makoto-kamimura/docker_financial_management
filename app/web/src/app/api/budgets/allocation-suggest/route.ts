import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { suggestAllocation, type AllocationRule } from "@/lib/allocation";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";

// GET /api/budgets/allocation-suggest?year=&month=&basis=budget|actual … 配分提案（読み取り専用）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    basis: z.enum(["budget", "actual"]).default("budget"),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month, basis } = query;

    const period = await db.period.findUnique({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
    });

    let basisAmount = 0;
    if (period) {
      if (basis === "budget") {
        const rows = await db.budget.findMany({
          where: { tenantId, periodId: period.id, account: { category: "REVENUE" } },
          select: { amount: true },
        });
        basisAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
      } else {
        const rows = await db.financialRecord.findMany({
          where: { tenantId, periodId: period.id, account: { category: "REVENUE" } },
          select: { amount: true },
        });
        basisAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
      }
    }

    const [loanOverlay, debtOverlay] = await Promise.all([
      computeLoanOverlay(db, tenantId, year),
      computePersonalAssetDebtOverlay(db, tenantId, year),
    ]);
    const overlays = [...loanOverlay, ...debtOverlay]
      .filter((o) => o.month === month)
      .map((o) => ({ accountId: o.accountId, amount: o.amount }));

    const rules = await db.allocationRule.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    const ruleInputs: AllocationRule[] = rules.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      group: r.group,
      minPercent: Number(r.minPercent),
      maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
      accountId: r.accountId,
      sortOrder: r.sortOrder,
    }));

    const result = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });

    return NextResponse.json({ data: { year, month, basis, ...result } });
  },
});
