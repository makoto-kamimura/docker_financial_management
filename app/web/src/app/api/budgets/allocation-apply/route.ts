import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { recordBudgetHistory } from "@/lib/budget/budget-history";
import { assertBudgetPeriodEditable } from "@/lib/budget/budget-lock";
import { notFound } from "@/lib/server/api-error";
import { resolvePeriod } from "@/lib/accounting/period";
import { zMoney } from "@/lib/common/schemas";

const ApplySchema = z.object({
  year: z.number().int(),
  items: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        month: z.number().int().min(1).max(12),
        amount: zMoney,
      }),
    )
    .min(1)
    .max(200),
  // true（既定）: すでに予算が入っている科目は書き換えずに飛ばす（配分は予算が未設定の科目に入れる）
  onlyUnset: z.boolean().default(true),
});

// POST /api/budgets/allocation-apply … 配分提案を予算へ一括反映（editor 以上）
//   既定（onlyUnset）では、すでに予算が入っている科目は飛ばす。画面は予算が未設定の科目だけに
//   残りを按分して送るが、送るまでの間に他で予算が入った場合も上書きしないよう、ここでも確かめる。
export const POST = withApi({
  role: "editor",
  schema: ApplySchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const { year, items, onlyUnset } = body;

    // 対象科目がすべて自テナントに属することを事前検証する（他テナント混入は書き込み前に 404）
    const accountIds = [...new Set(items.map((i) => i.accountId))];
    const owned = await db.account.findMany({
      where: { id: { in: accountIds }, tenantId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((a) => a.id));
    if (accountIds.some((id) => !ownedIds.has(id))) {
      throw notFound("一部の科目が存在しないか、権限がありません");
    }

    const periods = new Map<number, { id: number }>();
    for (const month of new Set(items.map((i) => i.month))) {
      const period = await resolvePeriod(db, tenantId, year, month);
      await assertBudgetPeriodEditable(db, period.id, `${year}年${month}月`);
      periods.set(month, period);
    }

    const before = await db.budget.findMany({
      where: {
        tenantId,
        accountId: { in: accountIds },
        periodId: { in: [...periods.values()].map((p) => p.id) },
      },
      select: { amount: true },
    });
    const beforeTotal = before.reduce((sum, b) => sum + Number(b.amount), 0);
    const afterTotal = items.reduce((sum, i) => sum + i.amount, 0);

    let applied = 0;
    let skipped = 0;
    for (const item of items) {
      const periodId = periods.get(item.month)!.id;
      const prev = await db.budget.findUnique({
        where: { tenantId_accountId_periodId: { tenantId, accountId: item.accountId, periodId } },
      });
      if (prev && onlyUnset) {
        skipped++;
        continue;
      }
      applied++;
      const budget = await db.budget.upsert({
        where: { tenantId_accountId_periodId: { tenantId, accountId: item.accountId, periodId } },
        update: { amount: item.amount },
        create: { tenantId, accountId: item.accountId, periodId, amount: item.amount },
      });
      await recordBudgetHistory(db, {
        tenantId,
        budgetId: budget.id,
        accountId: item.accountId,
        periodId,
        userId: user.id,
        action: prev ? "update" : "create",
        amount: item.amount,
      });
    }

    await audit("allocation_apply", `budgets:${applied}`, {
      before: { total: beforeTotal },
      after: { total: afterTotal, skipped },
    });

    return NextResponse.json({ data: { applied, skipped } }, { status: 201 });
  },
});
