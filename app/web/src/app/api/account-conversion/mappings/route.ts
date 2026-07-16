import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { saveManualMappingRule } from "@/lib/account-conversion";

const MappingSchema = z.object({
  homeCode: z.string().min(1),
  corporateCode: z.string().nullable(),
  isConvertible: z.boolean().default(true),
  notes: z.string().optional(),
});

// GET /api/account-conversion/mappings … システム定義ルール（userId=null）＋ 自分の独自ルール
export const GET = withApi({
  role: "viewer",
  handler: async ({ user }) => {
    const userId = user.id;
    const rules = await prisma.accountMappingRule.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: { homeCode: "asc" },
    });
    const data = rules.map((r) => ({ ...r, isOwn: r.userId === userId }));
    return NextResponse.json({ data });
  },
});

// PUT /api/account-conversion/mappings … 手動マッピングを自分専用ルールとして登録・更新
export const PUT = withApi({
  role: "editor",
  schema: MappingSchema,
  handler: async ({ user, body }) => {
    const rule = await saveManualMappingRule(user.id, body.homeCode, body.corporateCode ?? null, {
      isConvertible: body.isConvertible,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ data: rule });
  },
});
