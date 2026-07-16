import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";

// GET /api/financials/recent?limit=20 … 直近の実績変更履歴
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
  handler: async ({ user, query }) => {
    const histories = await prisma.financialRecordHistory.findMany({
      where: { record: { tenantId: user.tenantId } },
      orderBy: { changedAt: "desc" },
      take: query.limit,
      include: {
        record: {
          include: {
            account: {
              select: {
                code: true,
                name: true,
                category: true,
                soleName: true,
                corporateName: true,
              },
            },
            period: { select: { fiscalYear: true, month: true } },
          },
        },
      },
    });

    return NextResponse.json({
      data: histories.map((h) => ({
        historyId: h.id,
        recordId: h.recordId,
        action: h.action,
        amount: Number(h.amount),
        changedAt: h.changedAt,
        userId: h.userId,
        account: h.record.account,
        period: h.record.period,
      })),
    });
  },
});
