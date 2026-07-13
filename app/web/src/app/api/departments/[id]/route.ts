import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  manager: z.string().optional().nullable(),
});

// PATCH /api/departments/[id] … 部門の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const existing = await db.department.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const dept = await db.department.update({ where: { id }, data: body });
    await audit("update", `department:${id}`);
    return NextResponse.json({ data: dept });
  },
});

// DELETE /api/departments/[id] … 部門の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const { tenantId } = user;
    const existing = await db.department.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    const hasRecords = await db.financialRecord.findFirst({
      where: { departmentId: id, tenantId },
    });
    if (hasRecords) throw conflict("実績データが存在するため削除できません");

    await db.department.delete({ where: { id } });
    await audit("delete", `department:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
