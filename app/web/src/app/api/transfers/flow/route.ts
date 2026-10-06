import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { loanFundingTransfers } from "@/lib/loan-funding";
import {
  buildTransferFlow,
  hasCycle,
  CHANNEL_LABELS,
  type TransferInput,
  type TransferChannel,
} from "@/lib/transferflow";

// GET /api/transfers/flow … 資金移動フロー図（Sankey）生成
//   資金移動ルールに加えて、引き落とし口座と日を入れた借入の返済も、口座から外部への引き落としとして描く
//   （同じ返済の資金移動ルールがあれば、そちらだけを描く。lib/loan-funding.ts）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const [transfers, loans] = await Promise.all([
      db.transfer.findMany({
        where: { tenantId: user.tenantId },
        include: { fromAccount: true, toAccount: true, linkedAccount: true },
        orderBy: [{ day: "asc" }, { id: "asc" }],
      }),
      db.loan.findMany({
        where: { tenantId: user.tenantId, debitBankAccountId: { not: null } },
        include: { debitBankAccount: { select: { name: true } } },
      }),
    ]);
    const loanFunding = loanFundingTransfers(
      loans,
      transfers.map((t) => ({ fromId: t.fromAccountId, day: t.day, amount: Number(t.amount) })),
    );

    const inputs: TransferInput[] = transfers.map((t) => ({
      fromId: t.fromAccountId,
      fromName: t.fromAccount?.name ?? null,
      toId: t.toAccountId,
      toName: t.toAccount?.name ?? null,
      amount: Number(t.amount),
      channel: t.channel as TransferChannel,
      // カード引き落としは紐付けたカード名を外部ノードのラベルに使う（未設定ならラベル→種別名）
      label: t.label ?? t.linkedAccount?.name ?? null,
    }));
    for (const lt of loanFunding.transfers) {
      inputs.push({
        fromId: lt.fromId,
        fromName: loans.find((l) => l.id === lt.loanId)?.debitBankAccount?.name ?? null,
        toId: null,
        toName: null,
        amount: lt.amount,
        channel: "AUTO_DEBIT",
        label: lt.label,
      });
    }

    const cyclic = hasCycle(inputs);
    const graph = cyclic ? { nodes: [], links: [] } : buildTransferFlow(inputs);

    return NextResponse.json({
      cyclic,
      graph,
      transfers: transfers.map((t) => ({
        id: t.id,
        from: t.fromAccount?.name ?? null,
        to: t.toAccount?.name ?? null,
        amount: Number(t.amount),
        kind: t.kind,
        channel: t.channel,
        channelLabel: CHANNEL_LABELS[t.channel as TransferChannel],
        label: t.label,
        linkedAccountId: t.linkedAccountId,
        linkedAccountName: t.linkedAccount?.name ?? null,
        day: t.day,
        note: t.note,
      })),
    });
  },
});
