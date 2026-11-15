import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { UNPAIRED } from "@/lib/ledger/ledger-entries";
import { unassignedInMonthWhere } from "@/lib/ledger/actuals-coverage";
import { businessFields } from "@/lib/ledger/business-use";
import { businessPortion } from "@/lib/shared/business-use";

const LIMIT = 500;

// GET /api/ledger/unassigned?year=&month=[&includeAssigned=1] … その月の未割り当て（科目が付いていない）明細の一覧。
// 実績管理の「実績の確定」タブで、行ごとに科目・事業利用・按分を付けるために使う。
// includeAssigned=1 なら、科目の付いた明細も返す（付けた科目・事業利用を見直すため）。
// 振替・チャージの組は含めない（科目を付けない明細のため）。
// 未割り当てが残っている月は実績を確定できない（POST /api/actuals/confirm）。unassignedCount はその件数で、
// 明細分け（通販の注文）の科目の無い商品も含む。shopItemCount はそのうちの商品の件数（一覧の行には出さない。
// 商品の科目は明細分けの履歴で付ける）。明細分けに紐付いた明細そのものは一覧に出さない（UNPAIRED）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    includeAssigned: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
  }),
  handler: async ({ db, query }) => {
    const inMonth = {
      kind: { not: null },
      ...UNPAIRED,
      date: {
        gte: new Date(query.year, query.month - 1, 1),
        lt: new Date(query.year, query.month, 1),
      },
    } as const;
    const [rows, unassignedCount, shopItemCount] = await Promise.all([
      db.financialRecord.findMany({
        where: { ...inMonth, ...(query.includeAssigned ? {} : { accountId: null }) },
        select: {
          id: true,
          kind: true,
          date: true,
          description: true,
          flow: true,
          amount: true,
          accountId: true,
          businessUse: true,
          businessRatio: true,
          account: { select: { id: true, code: true, name: true, category: true } },
          bankAccount: { select: { name: true } },
          cardAccount: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      }),
      db.financialRecord.count({ where: unassignedInMonthWhere(query.year, query.month) }),
      db.financialRecord.count({
        where: { ...unassignedInMonthWhere(query.year, query.month), splitOfId: { not: null } },
      }),
    ]);
    const truncated = rows.length > LIMIT;
    return NextResponse.json({
      data: rows.slice(0, LIMIT).map((r) => {
        const business = businessFields(r);
        return {
          id: r.id,
          kind: r.kind,
          date: r.date,
          description: r.description,
          /** +入金 / −出金 */
          amount: Number(r.flow),
          sourceName: r.bankAccount?.name ?? r.cardAccount?.name ?? "現金",
          categoryAccountId: r.accountId,
          categoryAccount: r.account,
          ...business,
          /** 事業の分の実績の金額（科目の向き。事業利用でなければ 0） */
          businessAmount:
            business.businessUse && business.businessRatio !== null
              ? businessPortion(Number(r.amount), business.businessRatio)
              : 0,
        };
      }),
      unassignedCount,
      shopItemCount,
      truncated,
    });
  },
});
