import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { recordBudgetHistory } from "@/lib/budget-history";

const UpdateSchema = z.object({ amount: z.number() });

// PATCH /api/budgets/[id] … 予算金額の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const existing = await db.budget.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const budget = await db.budget.update({ where: { id }, data: { amount: body.amount } });
    await recordBudgetHistory(db, {
      tenantId: user.tenantId,
      budgetId: budget.id,
      accountId: budget.accountId,
      periodId: budget.periodId,
      userId: user.id,
      action: "update",
      amount: body.amount,
    });
    await audit("update", `budget:${id}`);
    return NextResponse.json({ data: budget });
  },
});

// DELETE /api/budgets/[id] … 予算の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const existing = await db.budget.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    // 履歴は削除後も残す（budgetId は SET NULL される）ため、先に 1 行積んでから消す
    await recordBudgetHistory(db, {
      tenantId: user.tenantId,
      budgetId: existing.id,
      accountId: existing.accountId,
      periodId: existing.periodId,
      userId: user.id,
      action: "delete",
      amount: Number(existing.amount),
    });
    await db.budget.delete({ where: { id } });
    await audit("delete", `budget:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
