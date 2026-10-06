import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { assertBudgetPeriodEditable } from "@/lib/budget-lock";
import { recordBudgetHistory } from "@/lib/budget-history";

// DELETE /api/budget-items/[id] … カレンダーで登録した予算を 1 件削除する（editor 以上）。
//   同じ科目・月の予算（budgets.amount）から金額を引き、変更履歴を残す。予算を確定した月は 409。
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const { tenantId } = user;
    const item = await db.budgetItem.findUnique({ where: { id, tenantId } });
    if (!item) throw notFound();
    await assertBudgetPeriodEditable(db, item.periodId);

    await db.$transaction(async (tx) => {
      const budget = await tx.budget.findUnique({
        where: {
          tenantId_accountId_periodId: {
            tenantId,
            accountId: item.accountId,
            periodId: item.periodId,
          },
        },
      });
      if (budget) {
        const amount = Number(budget.amount) - Number(item.amount);
        await tx.budget.update({ where: { id: budget.id }, data: { amount } });
        await recordBudgetHistory(tx, {
          tenantId,
          budgetId: budget.id,
          accountId: item.accountId,
          periodId: item.periodId,
          userId: user.id,
          action: "update",
          amount,
        });
      }
      await tx.budgetItem.delete({ where: { id } });
    });

    await audit("delete", `budget-item:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
