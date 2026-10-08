import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { assertBudgetPeriodEditable } from "@/lib/budget/budget-lock";
import { recordBudgetHistory } from "@/lib/budget/budget-history";
import { resolvePeriod, requireAccountByCode } from "@/lib/accounting/period";

const ItemSchema = z.object({
  date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  accountCode: z.string().min(1),
  description: z.string().trim().min(1).max(200),
  amount: z.number().positive(),
});

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/budget-items?year=&month= … 予算管理のカレンダーで登録した予算（月を省略すると年の全件）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ db, query }) => {
    const items = await db.budgetItem.findMany({
      where: {
        period: { fiscalYear: query.year, ...(query.month ? { month: query.month } : {}) },
      },
      include: {
        account: { select: { id: true, code: true, name: true, category: true } },
        period: { select: { fiscalYear: true, month: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({
      data: items.map((i) => ({ ...i, date: ymd(i.date), amount: Number(i.amount) })),
    });
  },
});

// POST /api/budget-items … カレンダーから予算を 1 件登録する（editor 以上）。
//   同じ科目・月の予算（budgets.amount）に金額を足し、変更履歴を残してから内訳の 1 件を作る。
//   予算を確定した月は 409。
export const POST = withApi({
  role: "editor",
  schema: ItemSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const account = await requireAccountByCode(db, tenantId, body.accountCode);
    const [year, month] = body.date.split("-").map(Number);
    const period = await resolvePeriod(db, tenantId, year, month);
    await assertBudgetPeriodEditable(db, period.id);

    const key = {
      tenantId_accountId_periodId: { tenantId, accountId: account.id, periodId: period.id },
    };
    const item = await db.$transaction(async (tx) => {
      const before = await tx.budget.findUnique({ where: key });
      const amount = Number(before?.amount ?? 0) + body.amount;
      const budget = await tx.budget.upsert({
        where: key,
        update: { amount },
        create: { tenantId, accountId: account.id, periodId: period.id, amount },
      });
      await recordBudgetHistory(tx, {
        tenantId,
        budgetId: budget.id,
        accountId: account.id,
        periodId: period.id,
        userId: user.id,
        action: before ? "update" : "create",
        amount,
      });
      return tx.budgetItem.create({
        data: {
          tenantId,
          accountId: account.id,
          periodId: period.id,
          date: new Date(`${body.date}T00:00:00Z`),
          description: body.description,
          amount: body.amount,
          createdById: user.id,
        },
      });
    });

    await audit("create", `budget-item:${item.id}`);
    return NextResponse.json(
      { data: { ...item, date: ymd(item.date), amount: Number(item.amount) } },
      { status: 201 },
    );
  },
});
