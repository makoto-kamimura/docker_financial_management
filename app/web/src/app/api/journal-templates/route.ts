import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { TEMPLATE_INCLUDE, TemplateLineSchema, toTemplateLineData } from "@/lib/journal-template";

const TemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  lines: z.array(TemplateLineSchema).min(1),
});

// GET /api/journal-templates … 仕訳テンプレート一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const templates = await db.journalTemplate.findMany({
      where: { tenantId: user.tenantId },
      include: TEMPLATE_INCLUDE,
      orderBy: { id: "asc" },
    });
    return NextResponse.json({ data: templates });
  },
});

// POST /api/journal-templates … 仕訳テンプレートの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: TemplateSchema,
  handler: async ({ user, db, body }) => {
    const template = await db.journalTemplate.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        description: body.description ?? null,
        lines: { create: toTemplateLineData(body.lines) },
      },
      include: TEMPLATE_INCLUDE,
    });
    return NextResponse.json({ data: template }, { status: 201 });
  },
});
