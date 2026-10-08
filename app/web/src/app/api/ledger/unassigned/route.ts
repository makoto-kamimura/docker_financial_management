import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { UNPAIRED } from "@/lib/ledger-entries";

// GET /api/ledger/unassigned?year=&month= … その月の未割り当て（科目が付いていない）明細の一覧。
// 実績管理の「実績の確定」タブで、行ごとに科目を付けるために使う。振替・チャージの組は含めない
// （科目を付けない明細のため）。未割り当てが残っている月は実績を確定できない（POST /api/actuals/confirm）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ db, query }) => {
    const rows = await db.financialRecord.findMany({
      where: {
        kind: { not: null },
        accountId: null,
        ...UNPAIRED,
        date: {
          gte: new Date(query.year, query.month - 1, 1),
          lt: new Date(query.year, query.month, 1),
        },
      },
      select: {
        id: true,
        kind: true,
        date: true,
        description: true,
        flow: true,
        bankAccount: { select: { name: true } },
        cardAccount: { select: { name: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: 500,
    });
    return NextResponse.json({
      data: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        date: r.date,
        description: r.description,
        /** +入金 / −出金 */
        amount: Number(r.flow),
        sourceName: r.bankAccount?.name ?? r.cardAccount?.name ?? "現金",
      })),
    });
  },
});
