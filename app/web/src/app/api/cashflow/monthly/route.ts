import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import {
  buildMonthlyCashFlow,
  estimateMissingEdges,
  type MonthlyTxnEdgeInput,
} from "@/lib/cashflow-monthly";
import type { TransferChannel, TransferInput } from "@/lib/transferflow";

// 推測フローの学習に使う過去の月数（対象月の直前 N か月）
const HISTORY_MONTHS = 3;

// GET /api/cashflow/monthly?year=&month=
// 実績ベースの月間資金フロー図（収入源 → 口座 → カード/引落 → 支払項目）。
// 紐付け済み（categoryAccountId 設定済み）の入出金明細と資金移動ルールから構築し、
// 対象月に実績がまだ無い口座 × 科目は直近 3 か月の平均から推測して破線で描く。
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
      include: { fromAccount: true, toAccount: true, linkedAccount: true },
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
      // カード引き落としは紐付けたカード名を外部ノードのラベルに使う（未設定ならラベル→種別名）
      label: t.label ?? t.linkedAccount?.name ?? null,
    }));

    // 実績がまだ入力されていない口座 × 科目は、直近 HISTORY_MONTHS か月の平均から推測して補う
    // （フロー図では破線・アンバーで描画される）
    const historyStart = new Date(year, month - 1 - HISTORY_MONTHS, 1);
    const historyTxns = await db.bankTransaction.findMany({
      where: {
        account: { tenantId },
        date: { gte: historyStart, lt: start },
        categoryAccountId: { not: null },
      },
      include: {
        account: { select: { id: true, name: true } },
        categoryAccount: { select: { id: true, name: true } },
      },
    });

    const historyInputs: MonthlyTxnEdgeInput[] = historyTxns.map((t) => ({
      accountId: t.accountId,
      accountName: t.account.name,
      amount: Number(t.amount),
      categoryAccountId: t.categoryAccountId,
      categoryName: t.categoryAccount?.name ?? null,
    }));

    const estimated = estimateMissingEdges(txnInputs, historyInputs, HISTORY_MONTHS);
    const graph = buildMonthlyCashFlow(txnInputs, transferInputs, estimated);

    return NextResponse.json({
      year,
      month,
      graph,
      estimatedCount: estimated.length,
      historyMonths: HISTORY_MONTHS,
    });
  },
});
