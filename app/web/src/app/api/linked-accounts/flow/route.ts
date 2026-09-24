import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import {
  aggregateBankCharges,
  aggregateCharges,
  buildCardFlow,
  hasCardFlowCycle,
  type BankChargeTxn,
  type CardChargeTxn,
  type CardFlowRecurring,
  type CardFlowTransfer,
} from "@/lib/card-flow";
import { CHANNEL_LABELS, type TransferChannel } from "@/lib/transferflow";

// GET /api/linked-accounts/flow
//   … カード・電子マネー関連の資金フロー図（カード・電子マネー管理のサマリタブ）。
//     1 枚の図に 4 種類の線を描く:
//       銀行口座 → カード   … 毎月の引き落とし（資金移動ルール）
//       銀行口座 → カード   … チャージ（銀行明細の chargeToAccountId。実績を月あたりに均した額）
//       カード → カード     … チャージ（カード明細の transferToAccountId。同上）
//       カード → 外部       … そのカードでの固定決済（CardRecurringPayment）
//
// 引き落とし設定がまだ無いカードは線を引けないので unlinked として返し、
// 画面側で「未登録」として案内する。
//
// チャージだけは実績（明細）が元なので、直近 CHARGE_MONTHS か月分を月平均にして
// 毎月の金額である他の線と太さを比べられるようにする。
const CHARGE_MONTHS = 3;

export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;

    const since = new Date();
    since.setMonth(since.getMonth() - CHARGE_MONTHS);

    const [transfers, linkedAccounts, chargeTxns, bankChargeTxns, recurringPayments] =
      await Promise.all([
        db.transfer.findMany({
          where: { tenantId, linkedAccountId: { not: null } },
          include: { fromAccount: true, linkedAccount: true },
          orderBy: [{ day: "asc" }, { id: "asc" }],
        }),
        db.linkedAccount.findMany({
          where: { tenantId },
          orderBy: { id: "asc" },
          select: { id: true, name: true, type: true },
        }),
        // チャージ指定済みの明細（transferToAccountId 付き）。明細は親カード経由でテナントを絞る
        db.cardTransaction.findMany({
          where: {
            account: { tenantId },
            transferToAccountId: { not: null },
            date: { gte: since },
          },
          select: {
            amount: true,
            account: { select: { name: true } },
            transferToAccount: { select: { name: true } },
          },
        }),
        // 銀行口座からのチャージ（プリペイド・電子マネーへの入金）。カード明細には現れないため
        // ここを見ないと、銀行から直接チャージしているカードが図に出てこない
        db.bankTransaction.findMany({
          where: {
            account: { tenantId },
            chargeToAccountId: { not: null },
            date: { gte: since },
          },
          select: {
            amount: true,
            account: { select: { name: true } },
            chargeToAccount: { select: { name: true } },
          },
        }),
        db.cardRecurringPayment.findMany({
          where: { tenantId },
          include: { account: { select: { id: true, name: true } } },
          orderBy: [{ day: "asc" }, { id: "asc" }],
        }),
      ]);

    const inputs: CardFlowTransfer[] = transfers.flatMap((t) =>
      t.linkedAccount
        ? [
            {
              fromAccountName: t.fromAccount?.name ?? null,
              linkedAccountName: t.linkedAccount.name,
              amount: Number(t.amount),
              channel: t.channel as TransferChannel,
              label: t.label,
            },
          ]
        : [],
    );

    const chargeInputs: CardChargeTxn[] = chargeTxns.flatMap((t) =>
      t.transferToAccount
        ? [
            {
              fromCardName: t.account.name,
              toCardName: t.transferToAccount.name,
              amount: Number(t.amount),
            },
          ]
        : [],
    );
    const charges = aggregateCharges(chargeInputs, CHARGE_MONTHS);

    // 銀行明細は「入金は正・出金は負」なので、チャージ（出金）が正になるよう符号を反転する
    const bankChargeInputs: BankChargeTxn[] = bankChargeTxns.flatMap((t) =>
      t.chargeToAccount
        ? [
            {
              fromBankName: t.account.name,
              toCardName: t.chargeToAccount.name,
              amount: -Number(t.amount),
            },
          ]
        : [],
    );
    const bankCharges = aggregateBankCharges(bankChargeInputs, CHARGE_MONTHS);

    const recurring: CardFlowRecurring[] = recurringPayments.map((r) => ({
      cardName: r.account.name,
      label: r.label,
      amount: Number(r.amount),
    }));

    // 引き落としルールが無くても、チャージ先・固定決済で図に出ているカードは「未登録」に含めない
    const drawnCardNames = new Set([
      ...charges.flatMap((c) => [c.fromCardName, c.toCardName]),
      ...bankCharges.map((c) => c.toCardName),
      ...recurring.map((r) => r.cardName),
    ]);
    const linkedIds = new Set(transfers.map((t) => t.linkedAccountId));

    // チャージがカード同士で循環していると Sankey が描画できない（銀行側の cyclic と同じ扱い）
    const cyclic = hasCardFlowCycle(charges);

    return NextResponse.json({
      cyclic,
      graph: cyclic
        ? { nodes: [], links: [] }
        : buildCardFlow({ transfers: inputs, charges, bankCharges, recurring }),
      chargeMonths: CHARGE_MONTHS,
      // 引き落とし・チャージ・固定決済のいずれにも現れないカード・電子マネー
      unlinked: linkedAccounts.filter((a) => !linkedIds.has(a.id) && !drawnCardNames.has(a.name)),
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
