import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { buildBankBalanceMap } from "@/lib/bank-balance";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// GET /api/bank-accounts/summary?year=&month= … 口座残高サマリ（ダッシュボードの KPI の対象月の時点。読み取り専用）
//   時点は総資産サマリ・総借入サマリと同じ（月末、今月なら今日）。残高は口座一覧と同じ定義
//   （明細の合計 + 差額。lib/bank-balance.ts）で、明細はその月の終わりまでを数える（総資産サマリと同じ範囲）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const asOf = isCurrentMonth ? now : new Date(year, month, 0);
    const nextMonthStart = new Date(year, month, 1);

    const [accounts, sums] = await Promise.all([
      db.bankAccount.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
        select: { id: true, name: true, bankName: true, balanceAdjustment: true, createdAt: true },
      }),
      db.ledgerEntry.groupBy({
        by: ["bankAccountId"],
        _sum: { amount: true },
        _max: { createdAt: true },
        where: { kind: "BANK", date: { lt: nextMonthStart } },
      }),
    ]);

    const balanceMap = buildBankBalanceMap(
      accounts,
      sums.map((s) => ({ accountId: s.bankAccountId!, sum: s._sum.amount?.toNumber() ?? 0 })),
    );
    // 明細を最後に登録した日時（どの口座も含めた最新。明細が無ければ口座の登録日時）
    const lastUpdatedAt = accounts.reduce<Date | null>((latest, a) => {
      const t = sums.find((s) => s.bankAccountId === a.id)?._max.createdAt ?? a.createdAt;
      return !latest || t > latest ? t : latest;
    }, null);

    const rows = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      bankName: a.bankName,
      balance: balanceMap.get(a.id) ?? 0,
    }));

    return NextResponse.json({
      data: {
        year,
        month,
        asOf: ymd(asOf),
        isCurrentMonth,
        totalBalance: rows.reduce((s, r) => s + r.balance, 0),
        lastUpdatedAt,
        accounts: rows,
      },
    });
  },
});
