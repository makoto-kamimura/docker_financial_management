import { NextResponse } from "next/server";
import path from "path";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { contentTypeForExtension } from "@/lib/server/upload";
import { uploadStorage } from "@/lib/server/storage";

// GET /api/uploads/[filename] … 証憑ファイルの配信。
// Receipt レコード経由で「自テナントの仕訳か現金の明細に紐づく証憑か」を確認してから配信する
// （他テナントのファイル名を知っていても 404 になり、存在の有無ごと秘匿する）。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, params, audit }) => {
    // パストラバーサル防止（DB 照合前に正規化しておく）
    const safe = path.basename(params.filename ?? "");

    const receipt = await db.receipt.findFirst({
      where: {
        savedName: safe,
        OR: [
          { journalEntry: { tenantId: user.tenantId } },
          { financialRecord: { tenantId: user.tenantId } },
        ],
      },
    });
    if (!receipt) throw notFound();

    // 置き場所（ローカル / R2）から読む。ローカルはテナント別ディレクトリ → 旧フラット構成の順に探す
    const bytes = await uploadStorage().get(user.tenantId, safe);
    if (!bytes) throw notFound();

    const ext = safe.split(".").pop()?.toLowerCase() ?? "";
    const contentType = receipt.mimeType || contentTypeForExtension(ext);

    // S-12: 詳細設計書 §8 の記録必須イベント「receipt_download」（証憑は税務書類のため取得も記録する）
    await audit("receipt_download", `receipt:${receipt.id}`);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  },
});
