import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";
import { CardRecurringPatchSchema } from "@/lib/card-recurring-schema";

// PATCH /api/card-recurring-payments/[id] … 固定決済の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: CardRecurringPatchSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const existing = await db.cardRecurringPayment.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    // 摘要を変える場合だけ、同じカード内での重複を確認する
    if (body.label && body.label !== existing.label) {
      const duplicate = await db.cardRecurringPayment.findFirst({
        where: { accountId: existing.accountId, label: body.label },
        select: { id: true },
      });
      if (duplicate) throw conflict("同じ摘要の固定決済が既に登録されています");
    }

    const item = await db.cardRecurringPayment.update({ where: { id }, data: body });
    await audit("update", `card_recurring_payment:${id}`);
    return NextResponse.json({ data: { ...item, amount: Number(item.amount) } });
  },
});

// DELETE /api/card-recurring-payments/[id] … 固定決済の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const existing = await db.cardRecurringPayment.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    await db.cardRecurringPayment.delete({ where: { id } });
    await audit("delete", `card_recurring_payment:${id}`);
    return NextResponse.json({ ok: true });
  },
});
