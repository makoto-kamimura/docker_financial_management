import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const UpdateSchema = z.object({ amount: z.number() });

// PATCH /api/financials/[id] … 実績金額の更新（履歴付き、editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const before = await db.financialRecord.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!before) throw notFound();

    const record = await db.financialRecord.update({
      where: { id },
      data: { amount: body.amount },
    });
    await db.financialRecordHistory.create({
      data: { recordId: id, userId: user.id, action: "update", amount: body.amount },
    });
    await audit("update", `financial_record:${id}`);
    return NextResponse.json({ data: record });
  },
});

// DELETE /api/financials/[id] … 実績の削除（履歴付き、editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const record = await db.financialRecord.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!record) throw notFound();

    await db.financialRecordHistory.create({
      data: { recordId: id, userId: user.id, action: "delete", amount: record.amount },
    });
    await db.financialRecord.delete({ where: { id } });
    await audit("delete", `financial_record:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
