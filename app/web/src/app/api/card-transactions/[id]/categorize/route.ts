import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { categorizeEntry } from "@/lib/ledger-categorize";
import { toCardTxn } from "@/lib/ledger-entries";

const Schema = z.object({
  categoryAccountId: z.number().int().positive().nullable().optional(),
  post: z.boolean().optional(),
  learn: z.boolean().optional(),
});

// PATCH /api/card-transactions/[id]/categorize … カード明細への科目紐付け・実績転記（editor 以上）
// 処理は lib/ledger-categorize.ts（銀行・カード共通）。
export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { before, updated, updatedSiblingCount } = await categorizeEntry(
      db,
      { tenantId: user.tenantId, userId: user.id },
      "CARD",
      id,
      body,
    );

    await audit("card_txn_categorize", `card_transaction:${id}`, {
      before,
      after: {
        categoryAccountId: updated.categoryAccountId,
        postedRecordId: updated.postedRecordId,
      },
      ...(updatedSiblingCount > 0 ? { updatedSiblingCount } : {}),
    });

    return NextResponse.json({ data: toCardTxn(updated), updatedSiblingCount });
  },
});
