import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { serializeBankTransaction } from "@/lib/bank-transactions";
import { validateTransferLink } from "@/lib/transfer-match";
import { invalidateCache } from "@/lib/redis";

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

    // 明細は親口座（BankAccount）経由でテナント所有を確認する
    const txns = await db.bankTransaction.findMany({
      where: { id: { in: [body.outTxnId, body.inTxnId] }, account: { tenantId } },
      select: {
        id: true,
        accountId: true,
        amount: true,
        categoryAccountId: true,
        transferGroupId: true,
        postedRecordId: true,
        chargeToAccountId: true,
      },
    });
    const outTxn = txns.find((t) => t.id === body.outTxnId);
    const inTxn = txns.find((t) => t.id === body.inTxnId);
    if (!outTxn || !inTxn) throw notFound("明細が見つかりません");

    const linkable = (t: (typeof txns)[number]) => ({ ...t, amount: Number(t.amount) });
    const error = validateTransferLink(linkable(outTxn), linkable(inTxn));
    if (error) throw badRequest(error);
    // 呼び出し側が出金・入金を取り違えていても、符号を見て正しい向きで扱う
    if (Number(outTxn.amount) > 0) throw badRequest("出金側と入金側が逆です");

    const transferGroupId = randomUUID();
    // 片側だけ更新されて対が壊れることが無いよう、2 行は同一トランザクションで更新する。
    // 振替は収入・支出ではないので、付いていた科目はここで外す
    const updated = await db.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: { id: { in: [outTxn.id, inTxn.id] } },
        data: { transferGroupId, categoryAccountId: null },
      });
      return tx.bankTransaction.findMany({
        where: { transferGroupId },
        orderBy: { amount: "asc" },
      });
    });

    await audit("link_bank_transfer", `bank_transfer:${transferGroupId}`, {
      before: { outTxnId: outTxn.id, inTxnId: inTxn.id },
      after: { transferGroupId },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ data: updated.map(serializeBankTransaction), transferGroupId });
  },
});

export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ transferGroupId: z.string().min(1) }),
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const { transferGroupId } = query;

    const txns = await db.bankTransaction.findMany({
      where: { transferGroupId, account: { tenantId } },
      select: { id: true },
    });
    if (txns.length === 0) throw notFound("振替が見つかりません");

    // 明細は残したまま対だけ外す。以後それぞれ科目の紐付け・実績転記ができるようになり、
    // 削除も 1 行ずつになる（紐付いている間は片方を消すと相手も一緒に消える）
    await db.bankTransaction.updateMany({
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
