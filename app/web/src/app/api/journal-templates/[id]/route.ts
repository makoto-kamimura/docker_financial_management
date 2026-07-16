import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { TEMPLATE_INCLUDE, TemplateLineSchema, toTemplateLineData } from "@/lib/journal-template";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  lines: z.array(TemplateLineSchema).optional(),
});

// GET /api/journal-templates/[id] … テンプレート 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const t = await db.journalTemplate.findUnique({
      where: { id, tenantId: user.tenantId },
      include: TEMPLATE_INCLUDE,
    });
    if (!t) throw notFound();
    return NextResponse.json({ data: t });
  },
});

// PUT /api/journal-templates/[id] … テンプレートの更新（明細は全置換、editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.journalTemplate.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    await db.$transaction(async (tx) => {
      await tx.journalTemplate.update({
        where: { id },
        data: {
          ...(body.name && { name: body.name }),
          description: body.description ?? undefined,
        },
      });
      if (body.lines) {
        await tx.journalTemplateLine.deleteMany({ where: { templateId: id } });
        await tx.journalTemplateLine.createMany({
          data: toTemplateLineData(body.lines).map((l) => ({ ...l, templateId: id })),
        });
      }
    });

    const updated = await db.journalTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    return NextResponse.json({ data: updated });
  },
});

// DELETE /api/journal-templates/[id] … テンプレートの削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.journalTemplate.findUnique({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw notFound();

    await db.journalTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
