import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  termStart: zDate.optional(),
  termEnd: zDate.optional(),
  salary: z.number().optional(),
});

// PUT /api/officers/[id] … 役員の更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.officer.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const officer = await db.officer.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.title && { title: body.title }),
        ...(body.termStart && { termStart: body.termStart }),
        ...(body.termEnd && { termEnd: body.termEnd }),
        salary: body.salary ?? undefined,
      },
    });
    return NextResponse.json({ data: officer });
  },
});

// DELETE /api/officers/[id] … 役員の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.officer.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.officer.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
