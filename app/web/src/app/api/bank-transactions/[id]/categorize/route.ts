import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";
import { normalizeKeyword } from "@/lib/banktxn-import";
import { serializeBankTransaction } from "@/lib/bank-transactions";

const Schema = z.object({
  categoryAccountId: z.number().int().positive().nullable().optional(),
  post: z.boolean().optional(),
  learn: z.boolean().optional(),
});

// PATCH /api/bank-transactions/[id]/categorize … 明細への科目紐付け・実績転記（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { tenantId } = user;

    // 明細は親口座（BankAccount）経由でテナント所有を確認する（他テナント明細は存在ごと秘匿）
    const txn = await db.bankTransaction.findFirst({
      where: { id, account: { tenantId } },
    });
    if (!txn) throw notFound();

    let categoryAccountId = txn.categoryAccountId;
    if (body.categoryAccountId !== undefined) {
      if (body.categoryAccountId === null) {
        categoryAccountId = null;
      } else {
        const account = await db.account.findUnique({
          where: { id: body.categoryAccountId, tenantId },
        });
        if (!account) throw notFound("科目が見つかりません");
        categoryAccountId = account.id;
      }
    }

    const before = {
      categoryAccountId: txn.categoryAccountId,
      postedRecordId: txn.postedRecordId,
    };

    // post 前提の期間解決は $transaction の外で行う（period.upsert は冪等なため安全）
    const period = body.post ? await resolvePeriodForDate(db, tenantId, txn.date) : null;

    const updated = await db.$transaction(async (tx) => {
      await tx.bankTransaction.update({ where: { id }, data: { categoryAccountId } });

      if (body.learn && categoryAccountId !== null) {
        const keyword = normalizeKeyword(txn.description);
        await tx.txnCategoryRule.upsert({
          where: { tenantId_keyword: { tenantId, keyword } },
          update: { categoryAccountId, priority: 100 },
          create: { tenantId, keyword, categoryAccountId, priority: 100 },
        });
      }

      if (body.post) {
        if (txn.postedRecordId) throw conflict("既に転記済みです");
        if (categoryAccountId === null) throw conflict("科目が未設定のため転記できません");

        const amount = Math.abs(Number(txn.amount));
        const record = await tx.financialRecord.create({
          data: { tenantId, accountId: categoryAccountId, periodId: period!.id, amount },
        });
        await tx.financialRecordHistory.create({
          data: { recordId: record.id, userId: user.id, action: "create", amount },
        });

        // postedRecordId が null のままの行だけを対象にした条件付き更新。並行リクエストで
        // 相手が先に成功していれば 0 件更新となり、@unique 制約と合わせて二重転記を防ぐ。
        const claim = await tx.bankTransaction.updateMany({
          where: { id, postedRecordId: null },
          data: { postedRecordId: record.id },
        });
        if (claim.count === 0) throw conflict("既に転記済みです");
      }

      return tx.bankTransaction.findUniqueOrThrow({ where: { id } });
    });

    await audit("txn_categorize", `bank_transaction:${id}`, {
      before,
      after: {
        categoryAccountId: updated.categoryAccountId,
        postedRecordId: updated.postedRecordId,
      },
    });

    return NextResponse.json({ data: serializeBankTransaction(updated) });
  },
});
