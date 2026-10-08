import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { categorizeEntry } from "@/lib/ledger/ledger-categorize";

const Schema = z.object({
  categoryAccountId: z.number().int().positive().nullable().optional(),
  learn: z.boolean().optional(),
});

// PATCH /api/actuals/[id]/categorize … 現金の明細の科目の変更（editor 以上）。
// 処理は lib/ledger/ledger-categorize.ts（銀行・カードと共通）。科目を付けた明細がそのまま実績になる。
export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, id, body, audit }) => {
    const { before, updated, updatedSiblingCount } = await categorizeEntry(
      db,
      { tenantId: user.tenantId },
      "CASH",
      id,
      body,
    );
    await audit("cash_entry_categorize", `financial_record:${id}`, {
      before,
      after: { categoryAccountId: updated.accountId, amount: Number(updated.amount) },
      ...(updatedSiblingCount > 0 ? { updatedSiblingCount } : {}),
    });
    return NextResponse.json({
      data: { id, categoryAccountId: updated.accountId },
      updatedSiblingCount,
    });
  },
});
