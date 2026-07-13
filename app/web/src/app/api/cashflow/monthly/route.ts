import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { buildMonthlyCashFlow, type MonthlyTxnEdgeInput } from "@/lib/cashflow-monthly";
import type { TransferChannel, TransferInput } from "@/lib/transferflow";

// GET /api/cashflow/monthly?year=&month=
// 実績ベースの月間資金フロー図（収入源 → 口座 → カード/引落 → 支払項目）。
// 紐付け済み（categoryAccountId 設定済み）の入出金明細と資金移動ルールから構築する。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month } = query;

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const txns = await db.bankTransaction.findMany({
      where: {
        account: { tenantId },
        date: { gte: start, lt: end },
        categoryAccountId: { not: null },
      },
      include: {
        account: { select: { id: true, name: true } },
        categoryAccount: { select: { id: true, name: true } },
      },
    });

    // 資金移動ルールは「毎月◯日」の繰り返しパターンのため、対象月に存在する日（1〜末日）のみ対象にする
    const daysInMonth = new Date(year, month, 0).getDate();
    const transfers = await db.transfer.findMany({
      where: { tenantId, day: { lte: daysInMonth } },
      include: { fromAccount: true, toAccount: true },
    });

    const txnInputs: MonthlyTxnEdgeInput[] = txns.map((t) => ({
      accountId: t.accountId,
      accountName: t.account.name,
      amount: Number(t.amount),
      categoryAccountId: t.categoryAccountId,
      categoryName: t.categoryAccount?.name ?? null,
    }));

    const transferInputs: TransferInput[] = transfers.map((t) => ({
      fromId: t.fromAccountId,
      fromName: t.fromAccount?.name ?? null,
      toId: t.toAccountId,
      toName: t.toAccount?.name ?? null,
      amount: Number(t.amount),
      channel: t.channel as TransferChannel,
      label: t.label,
    }));

    const graph = buildMonthlyCashFlow(txnInputs, transferInputs);

    return NextResponse.json({ year, month, graph });
  },
});
