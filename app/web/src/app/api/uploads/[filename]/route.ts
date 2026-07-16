import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { contentTypeForExtension, tenantUploadDir, UPLOAD_DIR } from "@/lib/upload";

// GET /api/uploads/[filename] … 証憑ファイルの配信。
// Receipt レコード経由で「自テナントの仕訳に紐づく証憑か」を確認してから配信する
// （他テナントのファイル名を知っていても 404 になり、存在の有無ごと秘匿する）。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, params, audit }) => {
    // パストラバーサル防止（DB 照合前に正規化しておく）
    const safe = path.basename(params.filename ?? "");

    const receipt = await db.receipt.findFirst({
      where: { savedName: safe, journalEntry: { tenantId: user.tenantId } },
    });
    if (!receipt) throw notFound();

    // S-8: テナント別ディレクトリを優先し、旧フラット構成（移行前のファイル）へフォールバックする
    const tenantPath = path.join(tenantUploadDir(user.tenantId), safe);
    const legacyPath = path.join(UPLOAD_DIR, safe);
    const filePath = existsSync(tenantPath) ? tenantPath : legacyPath;
    if (!existsSync(filePath)) throw notFound();

    const ext = safe.split(".").pop()?.toLowerCase() ?? "";
    const contentType = receipt.mimeType || contentTypeForExtension(ext);

    // S-12: 詳細設計書 §8 の記録必須イベント「receipt_download」（証憑は税務書類のため取得も記録する）
    await audit("receipt_download", `receipt:${receipt.id}`);

    const bytes = await readFile(filePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  },
});
