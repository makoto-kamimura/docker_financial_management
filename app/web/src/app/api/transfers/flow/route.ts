import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { CHANNEL_LABELS, type TransferChannel } from "@/lib/transferflow";

// GET /api/transfers/flow … 資金移動ルール（毎月の入出金）の一覧。
//   銀行の履歴の「毎月の入出金」（web の TransferRulesCard・モバイルの TransferRules）で使う。
//   以前は資金移動フロー図も返していたが、図は画面から消したので一覧だけを返す。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const transfers = await db.transfer.findMany({
      where: { tenantId: user.tenantId },
      include: { fromAccount: true, toAccount: true, linkedAccount: true },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        id: t.id,
        from: t.fromAccount?.name ?? null,
        to: t.toAccount?.name ?? null,
        // 銀行管理の「表示する銀行」で絞るための口座 id（外部は null）
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
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
