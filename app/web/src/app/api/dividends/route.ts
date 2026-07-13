import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { zDate } from "@/lib/zod-helpers";

const DividendSchema = z.object({
  resolutionDate: zDate,
  paymentDate: zDate,
  perShareAmount: z.number().default(0),
  totalAmount: z.number().positive(),
  note: z.string().optional(),
});

// GET /api/dividends … 配当一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const dividends = await db.dividend.findMany({
      where: { tenantId: user.tenantId },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { resolutionDate: "desc" },
    });
    return NextResponse.json({ data: dividends });
  },
});

// POST /api/dividends … 配当の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: DividendSchema,
  handler: async ({ user, db, body }) => {
    const div = await db.dividend.create({
      data: {
        tenantId: user.tenantId,
        resolutionDate: body.resolutionDate,
        paymentDate: body.paymentDate,
        perShareAmount: body.perShareAmount,
        totalAmount: body.totalAmount,
        note: body.note ?? null,
      },
    });
    return NextResponse.json({ data: div }, { status: 201 });
  },
});
