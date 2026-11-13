import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { deleteReceiptDraft, getReceiptDraft } from "@/lib/ledger/receipt-drafts";

// GET /api/actuals/drafts/[id] … 仮を 1 件（読み取りが終わったかを確かめるのにも使う）
export const GET = withApi({
  role: "viewer",
  handler: async ({ db, id }) => NextResponse.json({ data: await getReceiptDraft(db, id) }),
});

// DELETE /api/actuals/drafts/[id] … 仮を消す（写真のファイルも消す）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    await deleteReceiptDraft(db, user.tenantId, id);
    await audit("delete_receipt_draft", `receipt_draft:${id}`);
    return NextResponse.json({ ok: true });
  },
});
