import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import {
  CategorizeSchema,
  categorizeEntry,
  categorizedState,
} from "@/lib/ledger/ledger-categorize";
import { toBankTxn } from "@/lib/ledger/ledger-entries";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";

// PATCH /api/bank-transactions/[id]/categorize … 明細への科目の紐付け（editor 以上）。科目を付けた明細がそのまま実績になる
// 処理は lib/ledger/ledger-categorize.ts（銀行・カード共通）。
export const PATCH = withApi({
  role: "editor",
  schema: CategorizeSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const { before, updated, updatedSiblingCount } = await categorizeEntry(
      db,
      { tenantId: user.tenantId },
      "BANK",
      id,
      body,
    );

    await invalidateActualsCaches(user.tenantId);
    await audit("txn_categorize", `bank_transaction:${id}`, {
      before,
      after: categorizedState(updated),
      ...(updatedSiblingCount > 0 ? { updatedSiblingCount } : {}),
    });

    return NextResponse.json({ data: toBankTxn(updated), updatedSiblingCount });
  },
});
