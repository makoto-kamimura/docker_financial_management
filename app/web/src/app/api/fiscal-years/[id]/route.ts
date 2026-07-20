import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

const UpdateSchema = z.object({
  status: z.string().optional(),
  endDate: zDate.optional(),
});

// PUT /api/fiscal-years/[id] … 会計年度の更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.fiscalYear.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    // D-2: status は決算確定（/closing/finalize）と同じ FiscalYear 行を共有するため、
    // ここでの手動トグルも closedAt を連動させて整合を保つ
    const fy = await db.fiscalYear.update({
      where: { id },
      data: {
        ...(body.status && {
          status: body.status,
          closedAt: body.status === "closed" ? new Date() : null,
        }),
        ...(body.endDate && { endDate: body.endDate }),
      },
    });
    return NextResponse.json({ data: fy });
  },
});

// DELETE /api/fiscal-years/[id] … 会計年度の削除（admin）
export const DELETE = withApi({
  role: "admin",
  handler: async ({ user, db, id }) => {
    const existing = await db.fiscalYear.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.fiscalYear.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
