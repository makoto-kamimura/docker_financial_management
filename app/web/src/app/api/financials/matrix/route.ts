import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

// GET /api/financials/matrix?year=YYYY
//   … 実績管理のテーブル表示モード（勘定科目 × 月）用。指定年度の実績を明細のまま返す。
//     予算（/api/budgets）と同じ形で返し、クライアント側で科目 × 月に組み替える
//     （lib/financial-matrix.ts）。同じ科目・月に複数明細が存在しうる点が予算と異なる。
// 実績 1 行の出どころ。セルの内訳モーダルで「どこから入った実績か」を示すために使う。
// 銀行・カード明細からの転記は元の明細（日付・摘要・口座名）、仕訳連動は仕訳の摘要を添える。
type SourceRecord = {
  journalEntry: { id: number; transactionDate: Date; description: string } | null;
  postedFromTxn: {
    id: number;
    date: Date;
    description: string;
    account: { name: string };
  } | null;
  postedFromCardTxn: {
    id: number;
    date: Date;
    description: string;
    account: { name: string };
  } | null;
};

function recordSource(r: SourceRecord) {
  if (r.postedFromTxn) {
    return {
      kind: "bank" as const,
      date: r.postedFromTxn.date,
      description: r.postedFromTxn.description,
      accountName: r.postedFromTxn.account.name,
    };
  }
  if (r.postedFromCardTxn) {
    return {
      kind: "card" as const,
      date: r.postedFromCardTxn.date,
      description: r.postedFromCardTxn.description,
      accountName: r.postedFromCardTxn.account.name,
    };
  }
  if (r.journalEntry) {
    return {
      kind: "journal" as const,
      date: r.journalEntry.transactionDate,
      description: r.journalEntry.description,
      accountName: null,
    };
  }
  // 手入力・CSV 取込。どちらも直接書き込みで元の明細を持たない
  return { kind: "direct" as const, date: null, description: null, accountName: null };
}

export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year ?? new Date().getFullYear();

    const records = await db.financialRecord.findMany({
      where: { tenantId, period: { fiscalYear: year } },
      include: {
        account: { select: { id: true, code: true, name: true, category: true } },
        period: { select: { fiscalYear: true, month: true } },
        // 同じ科目・月に複数行あるセルは「◯件」を押すと内訳モーダルを出す。
        // どこから入った実績なのかが分かるよう、転記元の明細と仕訳を添える。
        journalEntry: { select: { id: true, transactionDate: true, description: true } },
        postedFromTxn: {
          select: {
            id: true,
            date: true,
            description: true,
            account: { select: { name: true } },
          },
        },
        postedFromCardTxn: {
          select: {
            id: true,
            date: true,
            description: true,
            account: { select: { name: true } },
          },
        },
      },
      orderBy: [{ account: { code: "asc" } }, { period: { month: "asc" } }, { id: "asc" }],
    });

    const years = await db.period.findMany({
      where: { tenantId },
      select: { fiscalYear: true },
      distinct: ["fiscalYear"],
      orderBy: { fiscalYear: "asc" },
    });

    return NextResponse.json({
      year,
      data: records.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        // 仕訳と連動した実績は金額をここで直接更新させない（仕訳側が正）
        journalEntryId: r.journalEntryId,
        account: r.account,
        period: r.period,
        createdAt: r.createdAt,
        source: recordSource(r),
      })),
      years: years.map((y) => y.fiscalYear),
    });
  },
});
