import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

// GET /api/budgets/history?limit=30&offset=0&sort=changedAt&order=desc&year=YYYY
//   … 予算の変更履歴。実績の /api/financials/recent と同じ形（data / total / limit / offset）で返し、
//     予算管理の「履歴」タブが実績管理の「履歴」と同じ見た目・ページ送りで表示できるようにする。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
    sort: z.enum(["changedAt", "account", "amount"]).default("changedAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    year: z.coerce.number().int().optional(),
  }),
  handler: async ({ user, db, query }) => {
    // 予算は削除後も履歴を残す（budgetId は SET NULL）ため、履歴側の accountId / periodId で絞る
    const where = {
      tenantId: user.tenantId,
      ...(query.year ? { period: { fiscalYear: query.year } } : {}),
    };
    // 勘定科目は表示と同じくコード順。同値の並びは日時降順で安定させる。
    const orderBy =
      query.sort === "account"
        ? [{ account: { code: query.order } }, { changedAt: "desc" as const }]
        : query.sort === "amount"
          ? [{ amount: query.order }, { changedAt: "desc" as const }]
          : [{ changedAt: query.order }];

    const [total, histories] = await Promise.all([
      db.budgetHistory.count({ where }),
      db.budgetHistory.findMany({
        where,
        orderBy,
        skip: query.offset,
        take: query.limit,
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
      }),
    ]);

    return NextResponse.json({
      data: histories.map((h) => ({
        historyId: h.id,
        budgetId: h.budgetId,
        action: h.action,
        amount: Number(h.amount),
        changedAt: h.changedAt,
        userId: h.userId,
        account: h.account,
        period: h.period,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
});
