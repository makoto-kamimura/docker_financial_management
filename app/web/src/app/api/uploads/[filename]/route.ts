import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { contentTypeForExtension } from "@/lib/upload";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// GET /api/uploads/[filename] … 証憑ファイルの配信。
// Receipt レコード経由で「自テナントの仕訳に紐づく証憑か」を確認してから配信する
// （他テナントのファイル名を知っていても 404 になり、存在の有無ごと秘匿する）。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, params }) => {
    // パストラバーサル防止（DB 照合前に正規化しておく）
    const safe = path.basename(params.filename ?? "");

    const receipt = await db.receipt.findFirst({
      where: { savedName: safe, journalEntry: { tenantId: user.tenantId } },
    });
    if (!receipt) throw notFound();

    const filePath = path.join(UPLOAD_DIR, safe);
    if (!existsSync(filePath)) throw notFound();

    const ext = safe.split(".").pop()?.toLowerCase() ?? "";
    const contentType = receipt.mimeType || contentTypeForExtension(ext);

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
