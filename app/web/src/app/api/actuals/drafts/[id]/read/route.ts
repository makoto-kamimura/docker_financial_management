import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { rereadReceiptDraft } from "@/lib/ledger/receipt-drafts";

// POST /api/actuals/drafts/[id]/read … 読み取れなかった・止まった仮を、もう一度読み取る（応答は待たない）
export const POST = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const draft = await rereadReceiptDraft(db, user.tenantId, id);
    await audit("reread_receipt_draft", `receipt_draft:${id}`);
    return NextResponse.json({ data: draft });
  },
});
