import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { categorizeEntry } from "@/lib/ledger-categorize";
import { toBankTxn } from "@/lib/ledger-entries";

const Schema = z.object({
  categoryAccountId: z.number().int().positive().nullable().optional(),
  learn: z.boolean().optional(),
});

// PATCH /api/bank-transactions/[id]/categorize … 明細への科目の紐付け（editor 以上）。科目を付けた明細がそのまま実績になる
// 処理は lib/ledger-categorize.ts（銀行・カード共通）。
export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { before, updated, updatedSiblingCount } = await categorizeEntry(
      db,
      { tenantId: user.tenantId },
      "BANK",
      id,
      body,
    );

    await audit("txn_categorize", `bank_transaction:${id}`, {
      before,
      after: {
        categoryAccountId: updated.accountId,
        amount: Number(updated.amount),
      },
      ...(updatedSiblingCount > 0 ? { updatedSiblingCount } : {}),
    });

    return NextResponse.json({ data: toBankTxn(updated), updatedSiblingCount });
  },
});
