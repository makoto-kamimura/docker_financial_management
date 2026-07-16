import { NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { tenantUploadDir, UPLOAD_DIR } from "@/lib/upload";

// DELETE /api/journals/[id]/receipts/[receiptId] … 証憑の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, params, audit }) => {
    const receiptId = Number(params.receiptId);
    if (!Number.isInteger(receiptId) || receiptId <= 0) throw badRequest("invalid receiptId");

    const entry = await db.journalEntry.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!entry) throw notFound();

    const receipt = await db.receipt.findFirst({ where: { id: receiptId, journalEntryId: id } });
    if (!receipt) throw notFound();

    await db.receipt.delete({ where: { id: receiptId } });

    // ファイル削除はベストエフォート（DB レコード削除を優先し、ファイルI/O失敗で API 全体は失敗させない）
    if (receipt.savedName) {
      const tenantPath = path.join(tenantUploadDir(user.tenantId), receipt.savedName);
      const legacyPath = path.join(UPLOAD_DIR, receipt.savedName);
      await unlink(tenantPath).catch(() => unlink(legacyPath).catch(() => {}));
    }

    await audit("delete_receipt", `journal:${id}:receipt:${receiptId}`);
    return NextResponse.json({ ok: true });
  },
});
