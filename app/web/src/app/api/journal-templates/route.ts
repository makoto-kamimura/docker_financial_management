import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const INCLUDE = {
  lines: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

const LineSchema = z.object({
  side: z.string().min(1),
  accountId: z.number().int().positive(),
  amount: z.number().optional(),
  note: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const TemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  lines: z.array(LineSchema).min(1),
});

// GET /api/journal-templates … 仕訳テンプレート一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const templates = await db.journalTemplate.findMany({
      where: { tenantId: user.tenantId },
      include: INCLUDE,
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
        lines: {
          create: body.lines.map((l, i) => ({
            side: l.side,
            accountId: l.accountId,
            amount: l.amount ?? null,
            note: l.note ?? null,
            sortOrder: l.sortOrder ?? i,
          })),
        },
      },
      include: INCLUDE,
    });
    return NextResponse.json({ data: template }, { status: 201 });
  },
});
