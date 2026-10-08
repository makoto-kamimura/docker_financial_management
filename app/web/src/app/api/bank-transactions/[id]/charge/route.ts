import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { BANK, CARD, ENTRY_REFS_INCLUDE, toBankTxn } from "@/lib/ledger-entries";
import { validateChargePair } from "@/lib/charge-link";
import { isChargeableType } from "@/lib/linked-account-type";
import { invalidateCache } from "@/lib/redis";
import { assertActualsPeriodsEditable } from "@/lib/budget-lock";

// PATCH /api/bank-transactions/[id]/charge … 銀行明細のチャージ指定・解除（editor 以上）
//
// 銀行口座からデビット・プリペイド・電子マネーへチャージした出金は、それ自体が支出ではなく
// 資金の移動で、実際の支出はチャージ先の利用明細で計上される。両方を科目に紐付けると
// 二重計上になるため、チャージ先を指定した明細は科目を外し、実績に入れない
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

    const txn = await db.financialRecord.findFirst({
      where: { id, ...BANK },
      select: {
        id: true,
        periodId: true,
        transferGroupId: true,
        chargeToCardId: true,
        chargeGroupId: true,
      },
    });
    if (!txn) throw notFound();

    if (body.chargeToAccountId === null && body.pairTxnId) {
      throw badRequest("チャージを解除するときは紐付け先を指定できません");
    }

    let pairTxnId: number | null = null;
    let pairPeriodId: number | null = null;
    if (body.chargeToAccountId !== null) {
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
        const pair = await db.financialRecord.findFirst({
          where: { id: body.pairTxnId, ...CARD },
          select: {
            id: true,
            cardAccountId: true,
            periodId: true,
            chargeGroupId: true,
            chargeToCardId: true,
          },
        });
        if (!pair) throw notFound("チャージ先の明細が見つかりません");
        const pairError = validateChargePair(
          {
            id: pair.id,
            accountId: pair.cardAccountId!,
            chargeGroupId: pair.chargeGroupId,
            transferToAccountId: pair.chargeToCardId,
          },
          target.id,
        );
        if (pairError) throw badRequest(pairError);
        pairTxnId = pair.id;
        pairPeriodId = pair.periodId;
      }
    }

    // 既に対になっているチャージ先の明細（解除・付け替えのときに一緒に外す）
    const previousPairIds = txn.chargeGroupId
      ? (
          await db.financialRecord.findMany({
            where: { chargeGroupId: txn.chargeGroupId, ...CARD },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [];

    // チャージにすると科目が外れて実績から抜けるので、実績を確定済みの月の明細は変えられない
    await assertActualsPeriodsEditable(db, [
      txn.periodId,
      ...(pairPeriodId === null ? [] : [pairPeriodId]),
    ]);

    const chargeGroupId = pairTxnId === null ? null : randomUUID();

    const updated = await db.$transaction(async (tx) => {
      if (previousPairIds.length > 0) {
        await tx.financialRecord.updateMany({
          where: { id: { in: previousPairIds } },
          data: { chargeGroupId: null },
        });
      }
      if (pairTxnId !== null) {
        await tx.financialRecord.update({
          where: { id: pairTxnId },
          data: { chargeGroupId, accountId: null, amount: 0 },
        });
      }
      return tx.financialRecord.update({
        where: { id },
        // チャージは支出ではないので、付いていた科目はここで外す
        data: {
          chargeToCardId: body.chargeToAccountId,
          chargeGroupId,
          ...(body.chargeToAccountId !== null ? { accountId: null, amount: 0 } : {}),
        },
        include: ENTRY_REFS_INCLUDE,
      });
    });

    await audit("set_bank_charge", `bank_transaction:${id}`, {
      before: { chargeToAccountId: txn.chargeToCardId, chargeGroupId: txn.chargeGroupId },
      after: { chargeToAccountId: body.chargeToAccountId, chargeGroupId, pairTxnId },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ data: toBankTxn(updated) });
  },
});
