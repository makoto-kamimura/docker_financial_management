import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import {
  buildTransferFlow,
  hasCycle,
  CHANNEL_LABELS,
  type TransferInput,
  type TransferChannel,
} from "@/lib/transferflow";

// GET /api/transfers/flow … 登録済みの資金移動から口座間フロー図(Sankey)を自動生成する。
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const transfers = await prisma.transfer.findMany({
    include: { fromAccount: true, toAccount: true },
    orderBy: [{ day: "asc" }, { id: "asc" }],
  });

  const inputs: TransferInput[] = transfers.map((t) => ({
    fromId: t.fromAccountId,
    fromName: t.fromAccount?.name ?? null,
    toId: t.toAccountId,
    toName: t.toAccount?.name ?? null,
    amount: Number(t.amount),
    channel: t.channel as TransferChannel,
    label: t.label,
  }));

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
      day: t.day,
      note: t.note,
    })),
  });
}
