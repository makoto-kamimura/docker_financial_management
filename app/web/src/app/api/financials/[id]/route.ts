import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, conflict, notFound } from "@/lib/api-error";

const UpdateSchema = z.object({
  amount: z.number().optional(),
  accountId: z.number().int().positive().optional(),
});

// PATCH /api/financials/[id] … 実績の金額・勘定科目の更新（履歴付き、editor 以上）
// 勘定科目を変更した場合、この実績が銀行/カード明細の「転記する」から作られたもの
// （BankTransaction.postedRecordId / CardTransaction.postedRecordId が指す行）であれば、
// 転記元明細側の categoryAccountId も追随して更新する（表示上の不整合を防ぐ）。
// journalEntryId が設定されている（複式仕訳から同期された）実績は、仕訳側の
// JournalDetail.accountId と食い違う・符号規約が崩れるおそれがあるため対象外とする。
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body, audit }) => {
    if (body.amount === undefined && body.accountId === undefined) {
      throw badRequest("amount または accountId のいずれかを指定してください");
    }

    const before = await db.financialRecord.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!before) throw notFound();

    if (body.accountId !== undefined && before.journalEntryId !== null) {
      throw conflict("仕訳と連動した実績のため、勘定科目は仕訳側で変更してください");
    }

    let newAccount: { id: number } | null = null;
    if (body.accountId !== undefined) {
      newAccount = await db.account.findUnique({
        where: { id: body.accountId, tenantId: user.tenantId },
      });
      if (!newAccount) throw notFound("科目が見つかりません");
    }

    const amount = body.amount ?? Number(before.amount);

    const record = await db.$transaction(async (tx) => {
      const updated = await tx.financialRecord.update({
        where: { id },
        data: {
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(newAccount ? { accountId: newAccount.id } : {}),
        },
      });

      if (newAccount) {
        const [bankTxn, cardTxn] = await Promise.all([
          tx.bankTransaction.findUnique({ where: { postedRecordId: id } }),
          tx.cardTransaction.findUnique({ where: { postedRecordId: id } }),
        ]);
        if (bankTxn) {
          await tx.bankTransaction.update({
            where: { id: bankTxn.id },
            data: { categoryAccountId: newAccount.id },
          });
        }
        if (cardTxn) {
          await tx.cardTransaction.update({
            where: { id: cardTxn.id },
            data: { categoryAccountId: newAccount.id },
          });
        }
      }

      await tx.financialRecordHistory.create({
        data: { recordId: id, userId: user.id, action: "update", amount },
      });

      return updated;
    });

    await audit("update", `financial_record:${id}`, {
      before: { amount: Number(before.amount), accountId: before.accountId },
      after: { amount: Number(record.amount), accountId: record.accountId },
    });
    return NextResponse.json({ data: record });
  },
});

// DELETE /api/financials/[id] … 実績の削除（履歴付き、editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const record = await db.financialRecord.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!record) throw notFound();

    await db.financialRecordHistory.create({
      data: { recordId: id, userId: user.id, action: "delete", amount: record.amount },
    });
    await db.financialRecord.delete({ where: { id } });
    await audit("delete", `financial_record:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
