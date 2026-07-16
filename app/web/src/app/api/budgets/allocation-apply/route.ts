import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { resolvePeriod } from "@/lib/period";
import { zMoney } from "@/lib/schemas";

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
});

// POST /api/budgets/allocation-apply … 配分提案を予算へ一括反映（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: ApplySchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const { year, items } = body;

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
      periods.set(month, await resolvePeriod(db, tenantId, year, month));
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

    await db.$transaction(
      items.map((item) => {
        const periodId = periods.get(item.month)!.id;
        return db.budget.upsert({
          where: { tenantId_accountId_periodId: { tenantId, accountId: item.accountId, periodId } },
          update: { amount: item.amount },
          create: { tenantId, accountId: item.accountId, periodId, amount: item.amount },
        });
      }),
    );

    await audit("allocation_apply", `budgets:${items.length}`, {
      before: { total: beforeTotal },
      after: { total: afterTotal },
    });

    return NextResponse.json({ data: { applied: items.length } }, { status: 201 });
  },
});
