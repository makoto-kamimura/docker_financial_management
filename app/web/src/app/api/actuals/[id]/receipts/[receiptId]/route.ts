import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, notFound } from "@/lib/server/api-error";
import { removeTenantUpload } from "@/lib/server/upload";
import { CASH } from "@/lib/ledger/ledger-entries";

// DELETE /api/actuals/[id]/receipts/[receiptId] … 現金の明細の証憑の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, params, audit }) => {
    const receiptId = Number(params.receiptId);
    if (!Number.isInteger(receiptId) || receiptId <= 0) throw badRequest("invalid receiptId");

    const entry = await db.financialRecord.findFirst({ where: { id, ...CASH } });
    if (!entry) throw notFound();
    const receipt = await db.receipt.findFirst({
      where: { id: receiptId, financialRecordId: id },
    });
    if (!receipt) throw notFound();

    await db.receipt.delete({ where: { id: receiptId } });
    // ファイル削除はベストエフォート（DB レコード削除を優先し、ファイルI/O失敗で API 全体は失敗させない）
    if (receipt.savedName) await removeTenantUpload(user.tenantId, receipt.savedName);

    await audit("delete_receipt", `financial_record:${id}:receipt:${receiptId}`);
    return NextResponse.json({ ok: true });
  },
});
