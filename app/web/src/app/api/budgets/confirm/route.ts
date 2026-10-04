import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, conflict, notFound } from "@/lib/api-error";
import { recordBudgetHistory } from "@/lib/budget-history";
import { resolvePeriod } from "@/lib/period";
import { zMoney } from "@/lib/schemas";

const ConfirmSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  // 確定と同時に書き込む予算（翌月の予算案）。省略時は登録済みの予算をそのまま確定する
  items: z
    .array(z.object({ accountId: z.number().int().positive(), amount: zMoney }))
    .max(500)
    .default([]),
});

// POST /api/budgets/confirm … 月の予算を確定する（editor 以上）
//   items があれば先に予算へ書き込み（変更履歴も残す）、そのうえで月を確定済みにする。
//   すでに確定済みの月は 409。確定後は、その月の予算の登録・変更・削除を受け付けない。
export const POST = withApi({
  role: "editor",
  schema: ConfirmSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const { year, month, items } = body;

    const accountIds = [...new Set(items.map((i) => i.accountId))];
    if (accountIds.length !== items.length) throw badRequest("同じ科目が重複しています");
    if (accountIds.length > 0) {
      const owned = await db.account.count({ where: { id: { in: accountIds }, tenantId } });
      if (owned !== accountIds.length) throw notFound("一部の科目が存在しないか、権限がありません");
    }

    const result = await db.$transaction(async (tx) => {
      const period = await resolvePeriod(tx, tenantId, year, month);
      const already = await tx.budgetConfirmation.findUnique({ where: { periodId: period.id } });
      if (already) throw conflict(`${year}年${month}月の予算はすでに確定済みです`);

      let written = 0;
      for (const item of items) {
        const where = {
          tenantId_accountId_periodId: { tenantId, accountId: item.accountId, periodId: period.id },
        };
        const prev = await tx.budget.findUnique({ where, select: { amount: true } });
        if (prev && Number(prev.amount) === item.amount) continue;
        const budget = await tx.budget.upsert({
          where,
          update: { amount: item.amount },
          create: { tenantId, accountId: item.accountId, periodId: period.id, amount: item.amount },
        });
        await recordBudgetHistory(tx, {
          tenantId,
          budgetId: budget.id,
          accountId: item.accountId,
          periodId: period.id,
          userId: user.id,
          action: prev ? "update" : "create",
          amount: item.amount,
        });
        written++;
      }

      const confirmation = await tx.budgetConfirmation.create({
        data: { tenantId, periodId: period.id, confirmedById: user.id },
      });
      return { written, confirmedAt: confirmation.confirmedAt };
    });

    await audit("budget_confirm", `budgets:${year}-${String(month).padStart(2, "0")}`, {
      after: { written: result.written },
    });
    return NextResponse.json(
      { data: { year, month, written: result.written, confirmedAt: result.confirmedAt } },
      { status: 201 },
    );
  },
});

// DELETE /api/budgets/confirm?year=&month= … 確定の解除（admin のみ）
//   予算の値は変えず、確定の印だけを外す。基準を動かす操作なので監査ログに残す。
export const DELETE = withApi({
  role: "admin",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const { year, month } = query;
    const period = await db.period.findUnique({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
      include: { budgetConfirmation: true },
    });
    if (!period?.budgetConfirmation)
      throw notFound(`${year}年${month}月の予算は確定されていません`);

    await db.budgetConfirmation.delete({ where: { periodId: period.id } });
    await audit("budget_unconfirm", `budgets:${year}-${String(month).padStart(2, "0")}`, {
      before: { confirmedAt: period.budgetConfirmation.confirmedAt.toISOString() },
    });
    return new NextResponse(null, { status: 204 });
  },
});
