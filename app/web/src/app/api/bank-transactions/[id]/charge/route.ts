import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { serializeBankTransaction } from "@/lib/bank-transactions";
import { validateChargePair } from "@/lib/charge-link";
import { isChargeableType } from "@/lib/linked-account-type";
import { invalidateCache } from "@/lib/redis";

// PATCH /api/bank-transactions/[id]/charge … 銀行明細のチャージ指定・解除（editor 以上）
//
// 銀行口座からデビット・プリペイド・電子マネーへチャージした出金は、それ自体が支出ではなく
// 資金の移動で、実際の支出はチャージ先の利用明細で計上される。両方を科目に紐付けると
// 二重計上になるため、チャージ先を指定した明細は科目紐付け・実績転記の対象外にする
// （カード明細の transferToAccountId と同じ扱い）。口座残高には従来どおり反映される。
//
// pairTxnId を添えると、チャージ先に入った明細と対にする（共通の chargeGroupId を与える）。
const Schema = z.object({
  chargeToAccountId: z.number().int().positive().nullable(),
  pairTxnId: z.number().int().positive().nullish(),
});

export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;

    // 明細は親口座（BankAccount）経由でテナント所有を確認する
    const txn = await db.bankTransaction.findFirst({
      where: { id, account: { tenantId } },
      select: {
        id: true,
        postedRecordId: true,
        transferGroupId: true,
        chargeToAccountId: true,
        chargeGroupId: true,
      },
    });
    if (!txn) throw notFound();

    if (body.chargeToAccountId === null && body.pairTxnId) {
      throw badRequest("チャージを解除するときは紐付け先を指定できません");
    }

    let pairTxnId: number | null = null;
    if (body.chargeToAccountId !== null) {
      // 転記済みは実績が既に立っており、対象外にしても実績は消えないため先に取り消しが要る
      if (txn.postedRecordId !== null) {
        throw badRequest(
          "実績へ転記済みの明細はチャージにできません（先に転記を取り消してください）",
        );
      }
      if (txn.transferGroupId !== null) {
        throw badRequest("口座間振替として紐付け済みの明細はチャージにできません");
      }

      const target = await db.linkedAccount.findUnique({
        where: { id: body.chargeToAccountId, tenantId },
        select: { id: true, type: true },
      });
      if (!target) throw notFound("チャージ先のカードが見つかりません");
      if (!isChargeableType(target.type)) {
        throw badRequest(
          "チャージ先にはデビットカード・プリペイドカード・電子マネーを選択してください",
        );
      }

      if (body.pairTxnId) {
        const pair = await db.cardTransaction.findFirst({
          where: { id: body.pairTxnId, account: { tenantId } },
          select: {
            id: true,
            accountId: true,
            postedRecordId: true,
            chargeGroupId: true,
            transferToAccountId: true,
          },
        });
        if (!pair) throw notFound("チャージ先の明細が見つかりません");
        const pairError = validateChargePair(pair, target.id);
        if (pairError) throw badRequest(pairError);
        pairTxnId = pair.id;
      }
    }

    // 既に対になっているチャージ先の明細（解除・付け替えのときに一緒に外す）
    const previousPairIds = txn.chargeGroupId
      ? (
          await db.cardTransaction.findMany({
            where: { chargeGroupId: txn.chargeGroupId, account: { tenantId } },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [];

    const chargeGroupId = pairTxnId === null ? null : randomUUID();

    const updated = await db.$transaction(async (tx) => {
      if (previousPairIds.length > 0) {
        await tx.cardTransaction.updateMany({
          where: { id: { in: previousPairIds } },
          data: { chargeGroupId: null },
        });
      }
      if (pairTxnId !== null) {
        await tx.cardTransaction.update({
          where: { id: pairTxnId },
          data: { chargeGroupId, categoryAccountId: null },
        });
      }
      return tx.bankTransaction.update({
        where: { id },
        // チャージは支出ではないので、付いていた科目はここで外す
        data: {
          chargeToAccountId: body.chargeToAccountId,
          chargeGroupId,
          ...(body.chargeToAccountId !== null ? { categoryAccountId: null } : {}),
        },
        include: {
          categoryAccount: { select: { id: true, code: true, name: true } },
          chargeToAccount: { select: { id: true, name: true } },
        },
      });
    });

    await audit("set_bank_charge", `bank_transaction:${id}`, {
      before: { chargeToAccountId: txn.chargeToAccountId, chargeGroupId: txn.chargeGroupId },
      after: { chargeToAccountId: body.chargeToAccountId, chargeGroupId, pairTxnId },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ data: serializeBankTransaction(updated) });
  },
});
