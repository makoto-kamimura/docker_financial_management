import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { historyFilterWhere, invalidHistoryFilter } from "@/lib/ledger/history-filter";
import {
  CASH_INCLUDE,
  ENTRY_REFS_INCLUDE,
  UNPAIRED,
  toBankTxn,
  toCardTxn,
  toCashEntry,
} from "@/lib/ledger/ledger-entries";

// GET /api/ledger/history?kind=&accountId=&status=&categoryAccountId=&businessOnly=&dateFrom=&dateTo=&q=&amountMin=&amountMax=&limit=&offset=
//   … 実績管理の「履歴」の明細（現金・銀行・カード）を、新しい順にページ単位で返す。
//     予算の履歴（/api/budgets/history）と同じ形（data / total / limit / offset）。
//   - kind: CASH / BANK / CARD。accountId は銀行の口座かカード（省略するとその種別のすべて）
//   - status: all（全件）/ unassigned（科目が無く、振替・チャージでもない明細）/ actual（科目の付いた明細）
//   - categoryAccountId: その科目の明細だけ
//   - businessOnly=1: 事業利用の明細だけ（個人事業主モードの「事業利用のみ」）
//   - dateFrom / dateTo（YYYY-MM-DD）・q（摘要の部分一致）・amountMin / amountMax（金額の絶対値）:
//     期間・摘要・金額の絞り込み（lib/ledger/history-filter.ts）。範囲が逆なら 400
//   行の形は種別ごとの一覧の API と同じ（現金は /api/actuals、銀行・カードは各口座の transactions）。
// YYYY-MM-DD の実在する日付（2037-01-34 のような日付は繰り上がるので受け付けない）
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  });

const KIND_WHERE = {
  CASH: (_id?: number): Prisma.FinancialRecordWhereInput => ({ kind: "CASH" }),
  BANK: (id?: number): Prisma.FinancialRecordWhereInput => ({
    kind: "BANK",
    ...(id ? { bankAccountId: id } : {}),
  }),
  CARD: (id?: number): Prisma.FinancialRecordWhereInput => ({
    kind: "CARD",
    ...(id ? { cardAccountId: id } : {}),
  }),
};

export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    kind: z.enum(["CASH", "BANK", "CARD"]),
    accountId: z.coerce.number().int().positive().optional(),
    status: z.enum(["all", "unassigned", "actual"]).default("all"),
    categoryAccountId: z.coerce.number().int().positive().optional(),
    businessOnly: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
    dateFrom: ymd.optional(),
    dateTo: ymd.optional(),
    q: z.string().max(100).optional(),
    amountMin: z.coerce.number().min(0).optional(),
    amountMax: z.coerce.number().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  handler: async ({ db, query }) => {
    const invalid = invalidHistoryFilter(query);
    if (invalid) throw badRequest(invalid);
    const where: Prisma.FinancialRecordWhereInput = {
      ...KIND_WHERE[query.kind](query.accountId),
      ...(query.status === "actual" ? { accountId: { not: null } } : {}),
      ...(query.status === "unassigned" ? { accountId: null, ...UNPAIRED } : {}),
      // 科目の絞り込みは状態の絞り込みより強い（科目を選べば、その科目の明細＝実績だけ）
      ...(query.categoryAccountId ? { accountId: query.categoryAccountId } : {}),
      ...(query.businessOnly ? { businessUse: true } : {}),
      AND: historyFilterWhere(query),
    };
    const page = {
      orderBy: [{ date: "desc" as const }, { id: "desc" as const }],
      skip: query.offset,
      take: query.limit,
    };

    const [total, data] = await Promise.all([
      db.financialRecord.count({ where }),
      query.kind === "CASH"
        ? db.financialRecord
            .findMany({ where, include: CASH_INCLUDE, ...page })
            .then((rows) => rows.map(toCashEntry))
        : db.financialRecord
            .findMany({ where, include: ENTRY_REFS_INCLUDE, ...page })
            .then((rows) =>
              query.kind === "BANK" ? rows.map((r) => toBankTxn(r)) : rows.map((r) => toCardTxn(r)),
            ),
    ]);
    return NextResponse.json({ data, total, limit: query.limit, offset: query.offset });
  },
});
