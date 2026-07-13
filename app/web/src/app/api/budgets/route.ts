import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { resolvePeriod, requireAccountByCode } from "@/lib/period";
import { computeHousingLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";

const BudgetSchema = z.object({
  accountCode: z.string().min(1),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number(),
});

// GET /api/budgets?year=YYYY … 予算一覧（ローン・実物資産負債のオーバーレイ付き）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year ?? new Date().getFullYear();

    const budgets = await db.budget.findMany({
      where: { tenantId, period: { fiscalYear: year } },
      include: {
        account: { select: { id: true, code: true, name: true, category: true } },
        period: { select: { fiscalYear: true, month: true } },
      },
      orderBy: [{ account: { code: "asc" } }, { period: { month: "asc" } }],
    });

    const years = await db.period.findMany({
      where: { tenantId },
      select: { fiscalYear: true },
      distinct: ["fiscalYear"],
      orderBy: { fiscalYear: "asc" },
    });

    const housingLoanOverlay = await computeHousingLoanOverlay(db, tenantId, year);
    const personalAssetDebtOverlay = await computePersonalAssetDebtOverlay(db, tenantId, year);

    return NextResponse.json({
      data: budgets,
      years: years.map((y) => y.fiscalYear),
      housingLoanOverlay,
      personalAssetDebtOverlay,
    });
  },
});

// POST /api/budgets … 予算の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: BudgetSchema,
  handler: async ({ user, db, body, audit }) => {
    const { accountCode, fiscalYear, month, amount } = body;
    const { tenantId } = user;

    const account = await requireAccountByCode(db, tenantId, accountCode);
    const period = await resolvePeriod(db, tenantId, fiscalYear, month);

    const budget = await db.budget.upsert({
      where: {
        tenantId_accountId_periodId: { tenantId, accountId: account.id, periodId: period.id },
      },
      update: { amount },
      create: { tenantId, accountId: account.id, periodId: period.id, amount },
      include: {
        account: { select: { id: true, code: true, name: true } },
        period: { select: { fiscalYear: true, month: true } },
      },
    });

    await audit("upsert", `budget:${budget.id}`);
    return NextResponse.json({ data: budget }, { status: 201 });
  },
});
