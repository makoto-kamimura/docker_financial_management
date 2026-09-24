import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { BankTransferCreateSchema, buildTransferPair } from "@/lib/bank-transfer";
import { serializeBankTransaction } from "@/lib/bank-transactions";
import { invalidateCache } from "@/lib/redis";

// POST /api/bank-transfers … 銀行から銀行への振替を 1 操作で登録する（editor 以上）
//
// 出金元に −amount、入金先に +amount の明細を 1 トランザクションで 2 行作り、
// transferGroupId で対にする。振替は収入・支出ではないので科目は紐付けない
// （明細一覧では「振替」バッジを出し、科目セレクタと転記ボタンを抑止する）。
export const POST = withApi({
  role: "editor",
  schema: BankTransferCreateSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;

    // 出金元・入金先ともに自テナントの口座であることを確認する
    const accounts = await db.bankAccount.findMany({
      where: { tenantId, id: { in: [body.fromAccountId, body.toAccountId] } },
      select: { id: true, name: true },
    });
    const from = accounts.find((a) => a.id === body.fromAccountId);
    const to = accounts.find((a) => a.id === body.toAccountId);
    if (!from || !to) throw notFound("口座が見つかりません");

    const transferGroupId = randomUUID();
    const rows = buildTransferPair(body, transferGroupId, {
      fromName: from.name,
      toName: to.name,
    });

    // 片側だけ登録されて残高がずれることが無いよう、2 行は必ず同一トランザクションで作る
    const created = await db.$transaction(async (tx) => {
      const out = await tx.bankTransaction.create({ data: { ...rows[0], source: "MANUAL" } });
      const income = await tx.bankTransaction.create({ data: { ...rows[1], source: "MANUAL" } });
      return [out, income];
    });

    await audit("create_bank_transfer", `bank_transfer:${transferGroupId}`);
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json(
      { data: created.map(serializeBankTransaction), transferGroupId },
      { status: 201 },
    );
  },
});
