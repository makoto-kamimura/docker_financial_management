import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const OfficerSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  termStart: zDate,
  termEnd: zDate,
  salary: z.number().optional(),
});

// GET /api/officers … 役員一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const officers = await db.officer.findMany({
      where: { tenantId: user.tenantId },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { termStart: "asc" },
    });
    return NextResponse.json({ data: officers });
  },
});

// POST /api/officers … 役員の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: OfficerSchema,
  handler: async ({ user, db, body }) => {
    const officer = await db.officer.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        title: body.title,
        termStart: body.termStart,
        termEnd: body.termEnd,
        salary: body.salary ?? null,
      },
    });
    return NextResponse.json({ data: officer }, { status: 201 });
  },
});
