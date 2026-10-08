import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { CARD, ENTRY_REFS_INCLUDE, toCardTxn } from "@/lib/ledger-entries";
import { validateCardTransferTarget } from "@/lib/card-transfer";
import { validateChargePair } from "@/lib/charge-link";
import { isChargeableType } from "@/lib/linked-account-type";
import { invalidateCache } from "@/lib/redis";

// PATCH /api/card-transactions/[id]/transfer … 明細 1 件のチャージ指定・解除（editor 以上）
//
// transferToAccountId に値を入れるとチャージ（資金移動）扱いになり、収入・支出に計上されなくなる。
// null を渡すと解除して通常の利用明細に戻す。銀行明細の振替紐付け／解除に対応する操作。
//
// pairTxnId を添えると、チャージ先に入った明細と対にする（共通の chargeGroupId を与える）。
// 対にした入金明細も科目紐付け・実績転記の対象外になり、チャージが二重計上されなくなる。
// チャージ先に入金の記録が無い場合（利用明細しか出てこない CSV）は省略できる。
const Schema = z.object({
  transferToAccountId: z.number().int().positive().nullable(),
  pairTxnId: z.number().int().positive().nullish(),
});

export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;

    const entry = await db.ledgerEntry.findFirst({
      where: { id, ...CARD },
      select: {
        id: true,
        cardAccountId: true,
        description: true,
        categoryAccountId: true,
        postedRecordId: true,
        chargeToCardId: true,
        chargeGroupId: true,
      },
    });
    if (!entry) throw notFound();
    const txn = {
      ...entry,
      accountId: entry.cardAccountId!,
      transferToAccountId: entry.chargeToCardId,
    };

    if (body.transferToAccountId === null && body.pairTxnId) {
      throw badRequest("チャージを解除するときは紐付け先を指定できません");
    }

    let pairTxnId: number | null = null;
    if (body.transferToAccountId !== null) {
      const error = validateCardTransferTarget(txn, body.transferToAccountId);
      if (error) throw badRequest(error);

      const target = await db.linkedAccount.findUnique({
        where: { id: body.transferToAccountId, tenantId },
        select: { id: true, type: true },
      });
      if (!target) throw notFound("チャージ先のカードが見つかりません");
      // チャージできるのは残高を持つ決済手段だけ。クレジットカードは後払いなので入金先にならない
      if (!isChargeableType(target.type)) {
        throw badRequest(
          "チャージ先にはデビットカード・プリペイドカード・電子マネーを選択してください",
        );
      }

      if (body.pairTxnId) {
        if (body.pairTxnId === id) throw badRequest("同じ明細どうしは紐付けできません");
        const pair = await db.ledgerEntry.findFirst({
          where: { id: body.pairTxnId, ...CARD },
          select: {
            id: true,
            cardAccountId: true,
            postedRecordId: true,
            chargeGroupId: true,
            chargeToCardId: true,
          },
        });
        if (!pair) throw notFound("チャージ先の明細が見つかりません");
        const pairError = validateChargePair(
          {
            id: pair.id,
            accountId: pair.cardAccountId!,
            postedRecordId: pair.postedRecordId,
            chargeGroupId: pair.chargeGroupId,
            transferToAccountId: pair.chargeToCardId,
          },
          target.id,
        );
        if (pairError) throw badRequest(pairError);
        pairTxnId = pair.id;
      }
    }

    // 既に対になっている相手（解除・付け替えのときに一緒に外す）。
    // この明細が「銀行からのチャージの入金側」だった場合、相手は銀行明細なので両方を見る。
    const previousGroupId = txn.chargeGroupId;
    const previousPairIds = previousGroupId
      ? (
          await db.ledgerEntry.findMany({
            where: { chargeGroupId: previousGroupId, id: { not: id }, ...CARD },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [];

    const chargeGroupId = pairTxnId === null ? null : randomUUID();

    // 対の片側だけが更新されて壊れることが無いよう、1 トランザクションでまとめて更新する
    const updated = await db.$transaction(async (tx) => {
      if (previousPairIds.length > 0) {
        await tx.ledgerEntry.updateMany({
          where: { id: { in: previousPairIds } },
          data: { chargeGroupId: null },
        });
      }
      if (previousGroupId) {
        await tx.ledgerEntry.updateMany({
          where: { chargeGroupId: previousGroupId, kind: "BANK" },
          data: { chargeGroupId: null },
        });
      }
      if (pairTxnId !== null) {
        // 入金側も収支の対象外にする（付いていた科目は外す）
        await tx.ledgerEntry.update({
          where: { id: pairTxnId },
          data: { chargeGroupId, categoryAccountId: null },
        });
      }
      return tx.ledgerEntry.update({
        where: { id },
        // チャージにするときは支出ではないので科目を外す。解除時は未紐付けのまま残し、
        // どの科目だったかは覚えていないので改めて選び直してもらう
        data: {
          chargeToCardId: body.transferToAccountId,
          chargeGroupId,
          ...(body.transferToAccountId !== null ? { categoryAccountId: null } : {}),
        },
        include: ENTRY_REFS_INCLUDE,
      });
    });

    await audit("set_card_transfer", `card_txn:${id}`, {
      before: { transferToAccountId: txn.transferToAccountId, chargeGroupId: txn.chargeGroupId },
      after: { transferToAccountId: body.transferToAccountId, chargeGroupId, pairTxnId },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ data: toCardTxn(updated) });
  },
});
