import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const PeriodSchema = z.object({
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
});

// GET /api/periods … 会計期間一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const periods = await db.period.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ fiscalYear: "asc" }, { month: "asc" }],
    });
    return NextResponse.json({ data: periods });
  },
});

// POST /api/periods … 会計期間の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: PeriodSchema,
  handler: async ({ user, db, body, audit }) => {
    const { fiscalYear, month } = body;
    const period = await db.period.create({
      data: { tenantId: user.tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
    });
    await audit("create", `period:${period.id}`);
    return NextResponse.json({ data: period }, { status: 201 });
  },
});
