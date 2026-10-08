import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { BANK, toBankTxn } from "@/lib/ledger-entries";
import { validateTransferLink } from "@/lib/transfer-match";
import { invalidateCache } from "@/lib/redis";
import { assertActualsPeriodsEditable } from "@/lib/budget-lock";

// 取込済みの明細どうしを後付けで振替として紐付ける／解除する（案 C）。
//
// POST   … 2 明細に共通の transferGroupId を与えて対にする（科目の紐付けは外す）
// DELETE … 紐付けを解除して、もとの独立した 2 明細に戻す
//
// どちらも明細そのものは作らず消さないので、口座残高（明細合計 + 差額）は変わらない。
// 変わるのは「収入・支出として集計されるかどうか」だけ。

const LinkSchema = z.object({
  outTxnId: z.number().int().positive(),
  inTxnId: z.number().int().positive(),
});

export const POST = withApi({
  role: "editor",
  schema: LinkSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    if (body.outTxnId === body.inTxnId) throw badRequest("同じ明細どうしは紐付けできません");

    const txns = (
      await db.financialRecord.findMany({
        where: { id: { in: [body.outTxnId, body.inTxnId] }, ...BANK },
        select: {
          id: true,
          bankAccountId: true,
          flow: true,
          periodId: true,
          transferGroupId: true,
          chargeToCardId: true,
        },
      })
    ).map(({ bankAccountId, chargeToCardId, flow, ...t }) => ({
      ...t,
      accountId: bankAccountId!,
      amount: Number(flow),
      chargeToAccountId: chargeToCardId,
    }));
    const outTxn = txns.find((t) => t.id === body.outTxnId);
    const inTxn = txns.find((t) => t.id === body.inTxnId);
    if (!outTxn || !inTxn) throw notFound("明細が見つかりません");

    const error = validateTransferLink(outTxn, inTxn);
    if (error) throw badRequest(error);
    // 呼び出し側が出金・入金を取り違えていても、符号を見て正しい向きで扱う
    if (outTxn.amount > 0) throw badRequest("出金側と入金側が逆です");
    // 振替にすると科目が外れて実績から抜けるので、実績を確定済みの月の明細は変えられない
    await assertActualsPeriodsEditable(db, [outTxn.periodId, inTxn.periodId]);

    const transferGroupId = randomUUID();
    // 片側だけ更新されて対が壊れることが無いよう、2 行は同一トランザクションで更新する。
    // 振替は収入・支出ではないので、付いていた科目はここで外す
    const updated = await db.$transaction(async (tx) => {
      await tx.financialRecord.updateMany({
        where: { id: { in: [outTxn.id, inTxn.id] } },
        data: { transferGroupId, accountId: null, amount: 0 },
      });
      return tx.financialRecord.findMany({
        where: { transferGroupId },
        orderBy: { flow: "asc" },
      });
    });

    await audit("link_bank_transfer", `bank_transfer:${transferGroupId}`, {
      before: { outTxnId: outTxn.id, inTxnId: inTxn.id },
      after: { transferGroupId },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ data: updated.map(toBankTxn), transferGroupId });
  },
});

export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ transferGroupId: z.string().min(1) }),
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const { transferGroupId } = query;

    const txns = await db.financialRecord.findMany({
      where: { transferGroupId, ...BANK },
      select: { id: true },
    });
    if (txns.length === 0) throw notFound("振替が見つかりません");

    // 明細は残したまま対だけ外す。以後それぞれ科目を付けられる（付けた明細が実績になる）ようになり、
    // 削除も 1 行ずつになる（紐付いている間は片方を消すと相手も一緒に消える）
    await db.financialRecord.updateMany({
      where: { id: { in: txns.map((t) => t.id) } },
      data: { transferGroupId: null },
    });

    await audit("unlink_bank_transfer", `bank_transfer:${transferGroupId}`, {
      before: { transferGroupId, txnIds: txns.map((t) => t.id) },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ ok: true, count: txns.length });
  },
});
