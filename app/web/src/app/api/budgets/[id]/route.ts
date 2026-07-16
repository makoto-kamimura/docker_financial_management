import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const UpdateSchema = z.object({ amount: z.number() });

// PATCH /api/budgets/[id] … 予算金額の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const existing = await db.budget.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const budget = await db.budget.update({ where: { id }, data: { amount: body.amount } });
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

    await db.budget.delete({ where: { id } });
    await audit("delete", `budget:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
