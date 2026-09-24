import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { DEFAULT_MAX_DAY_GAP, findTransferMatches, type MatchableTxn } from "@/lib/transfer-match";

// GET /api/bank-transfers/candidates?maxDayGap=&limit=
//
// 取込済みの明細から「振替の対になりそうな組」を拾う（案 C）。両口座の CSV を別々に取り込むと
// 1 回の資金移動が 2 明細に分かれて入るため、対にしておかないと収入・支出として二重計上される。
// ここが返すのはあくまで候補で、実際の紐付けは POST /api/bank-transfers/link で 1 組ずつ行う。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    maxDayGap: z.coerce.number().int().min(0).max(31).default(DEFAULT_MAX_DAY_GAP),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;

    const [accounts, rows] = await Promise.all([
      db.bankAccount.findMany({
        where: { tenantId },
        select: { id: true, name: true, bankName: true },
      }),
      // 紐付け済み（transferGroupId あり）と転記済みは対象外。転記済みは実績が既に立っており、
      // 後から振替に変えても FinancialRecord が残るため、先に転記の取り消しが要る
      db.bankTransaction.findMany({
        where: {
          account: { tenantId },
          transferGroupId: null,
          postedRecordId: null,
          // チャージ（カード・電子マネーへの資金移動）として指定済みの明細は口座間振替ではない
          chargeToAccountId: null,
          chargeGroupId: null,
        },
        select: {
          id: true,
          accountId: true,
          date: true,
          description: true,
          amount: true,
          categoryAccountId: true,
        },
        orderBy: { date: "desc" },
      }),
    ]);

    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const txns: (MatchableTxn & { categoryAccountId: number | null })[] = rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      date: r.date,
      description: r.description,
      amount: Number(r.amount),
      categoryAccountId: r.categoryAccountId,
    }));

    const matches = findTransferMatches(txns, { maxDayGap: query.maxDayGap });

    const side = (t: (typeof txns)[number]) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: accountMap.get(t.accountId)?.name ?? "—",
      bankName: accountMap.get(t.accountId)?.bankName ?? "",
      date: t.date,
      description: t.description,
      amount: t.amount,
      // 科目が付いたまま紐付けると外れるので、画面で「科目の紐付けは解除されます」と知らせる
      categoryAccountId: t.categoryAccountId,
    });

    return NextResponse.json({
      maxDayGap: query.maxDayGap,
      total: matches.length,
      data: matches.slice(0, query.limit).map((m) => ({
        out: side(m.outTxn),
        in: side(m.inTxn),
        amount: m.amount,
        dayGap: m.dayGap,
      })),
    });
  },
});
