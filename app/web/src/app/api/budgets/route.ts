import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { recordBudgetHistory } from "@/lib/budget/budget-history";
import { resolvePeriod, requireAccountByCode } from "@/lib/accounting/period";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget/budget-overlay";
import { assertBudgetPeriodEditable, confirmedBudgetMonths } from "@/lib/budget/budget-lock";
import { ScopeQuery } from "@/lib/ledger/scope";
import { budgetScopeOf } from "@/lib/budget/budget-scope";

const BudgetSchema = z.object({
  accountCode: z.string().min(1),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number(),
});

// GET /api/budgets?year=YYYY&scope= … 予算一覧（ローン・実物資産負債のオーバーレイ付き）
//   scope=business は個人事業主モードの事業の予算（予算は家庭と事業で別々に持つ。lib/budget/budget-scope.ts）
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year ?? new Date().getFullYear();
    const scope = budgetScopeOf(query.scope);

    const budgets = await db.budget.findMany({
      where: { tenantId, scope, period: { fiscalYear: year } },
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

    const loanOverlay = await computeLoanOverlay(db, tenantId, year, scope);
    const personalAssetDebtOverlay = await computePersonalAssetDebtOverlay(
      db,
      tenantId,
      year,
      scope,
    );
    const confirmed = await confirmedBudgetMonths(db, year, scope);
    // カレンダーで登録した予算（セルの内訳に出す）
    const items = await db.budgetItem.findMany({
      where: { scope, period: { fiscalYear: year } },
      include: {
        account: { select: { code: true } },
        period: { select: { month: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({
      data: budgets,
      years: years.map((y) => y.fiscalYear),
      loanOverlay,
      // 旧クライアント互換のため 1 リリース併存（住宅ローンに限らず全ローンを含む点が変更点）
      housingLoanOverlay: loanOverlay,
      personalAssetDebtOverlay,
      items: items.map((i) => ({
        id: i.id,
        accountCode: i.account.code,
        month: i.period.month,
        date: i.date.toISOString().slice(0, 10),
        description: i.description,
        amount: Number(i.amount),
        createdAt: i.createdAt,
      })),
      // 予算を確定済みの月（表の見出しに印を付け、編集を止める）
      confirmedMonths: confirmed.map((c) => c.month),
    });
  },
});

// POST /api/budgets?scope= … 予算の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: BudgetSchema,
  querySchema: ScopeQuery,
  handler: async ({ user, db, body, query, audit }) => {
    const { accountCode, fiscalYear, month, amount } = body;
    const { tenantId } = user;
    const scope = budgetScopeOf(query.scope);

    const account = await requireAccountByCode(db, tenantId, accountCode);
    const period = await resolvePeriod(db, tenantId, fiscalYear, month);
    await assertBudgetPeriodEditable(db, period.id, scope);

    // 既存有無で履歴の action（create / update）を分ける
    const before = await db.budget.findUnique({
      where: {
        tenantId_scope_accountId_periodId: {
          tenantId,
          scope,
          accountId: account.id,
          periodId: period.id,
        },
      },
    });

    const budget = await db.budget.upsert({
      where: {
        tenantId_scope_accountId_periodId: {
          tenantId,
          scope,
          accountId: account.id,
          periodId: period.id,
        },
      },
      update: { amount },
      create: { tenantId, scope, accountId: account.id, periodId: period.id, amount },
      include: {
        account: { select: { id: true, code: true, name: true } },
        period: { select: { fiscalYear: true, month: true } },
      },
    });
    await recordBudgetHistory(db, {
      tenantId,
      budgetId: budget.id,
      accountId: account.id,
      periodId: period.id,
      userId: user.id,
      action: before ? "update" : "create",
      amount,
      scope,
    });

    await audit("upsert", `budget:${budget.id}`);
    return NextResponse.json({ data: budget }, { status: 201 });
  },
});
