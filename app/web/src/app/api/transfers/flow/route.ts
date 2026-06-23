import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { buildTransferFlow, hasCycle, type TransferInput } from "@/lib/transferflow";

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
    fromName: t.fromAccount.name,
    toId: t.toAccountId,
    toName: t.toAccount.name,
    amount: Number(t.amount),
  }));

  // 循環があると Sankey は描画できないため、その場合はグラフを空にして警告を返す
  const cyclic = hasCycle(inputs);
  const graph = cyclic ? { nodes: [], links: [] } : buildTransferFlow(inputs);

  return NextResponse.json({
    cyclic,
    graph,
    transfers: transfers.map((t) => ({
      id: t.id,
      from: t.fromAccount.name,
      to: t.toAccount.name,
      amount: Number(t.amount),
      kind: t.kind,
      day: t.day,
      note: t.note,
    })),
  });
}
