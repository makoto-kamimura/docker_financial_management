import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";

// GET /api/financials/recent?limit=30&offset=0&sort=changedAt&order=desc
//   … 実績変更履歴。offset でページ送りし、日時 / 勘定科目 / 金額でソートできる。
//     total を返すため、呼び出し側で「次の30件」の有無を判定できる。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
    sort: z.enum(["changedAt", "account", "amount"]).default("changedAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
  }),
  handler: async ({ user, query }) => {
    const where = { record: { tenantId: user.tenantId } };
    // 勘定科目は表示と同じくコード順。同値の並びは日時降順で安定させる。
    const orderBy =
      query.sort === "account"
        ? [{ record: { account: { code: query.order } } }, { changedAt: "desc" as const }]
        : query.sort === "amount"
          ? [{ amount: query.order }, { changedAt: "desc" as const }]
          : [{ changedAt: query.order }];

    const [total, histories] = await Promise.all([
      prisma.financialRecordHistory.count({ where }),
      prisma.financialRecordHistory.findMany({
        where,
        orderBy,
        skip: query.offset,
        take: query.limit,
        include: {
          record: {
            include: {
              account: {
                select: {
                  id: true,
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
      }),
    ]);

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
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
});
