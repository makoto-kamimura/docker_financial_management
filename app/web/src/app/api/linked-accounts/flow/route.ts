import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { CHANNEL_LABELS, type TransferChannel } from "@/lib/ledger/transferflow";

// GET /api/linked-accounts/flow
//   … カード・電子マネーごとの、毎月の引き落とし（資金移動ルール）と固定決済（CardRecurringPayment）。
//     カード・電子マネー管理の一覧で、カードごとに並べる（モバイルのサマリも同じ）。
//     以前はカードの資金フロー図も返していたが、図は画面から消したので一覧に要るものだけを返す。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;
    const [transfers, recurringPayments] = await Promise.all([
      db.transfer.findMany({
        where: { tenantId, linkedAccountId: { not: null } },
        include: { fromAccount: true, linkedAccount: true },
        orderBy: [{ day: "asc" }, { id: "asc" }],
      }),
      db.cardRecurringPayment.findMany({
        where: { tenantId },
        include: { account: { select: { id: true, name: true } } },
        orderBy: [{ day: "asc" }, { id: "asc" }],
      }),
    ]);

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        id: t.id,
        from: t.fromAccount?.name ?? null,
        linkedAccountId: t.linkedAccountId,
        linkedAccountName: t.linkedAccount?.name ?? null,
        amount: Number(t.amount),
        channel: t.channel,
        channelLabel: CHANNEL_LABELS[t.channel as TransferChannel],
        label: t.label,
        day: t.day,
        note: t.note,
      })),
      recurring: recurringPayments.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        accountName: r.account.name,
        label: r.label,
        amount: Number(r.amount),
        day: r.day,
      })),
    });
  },
});
