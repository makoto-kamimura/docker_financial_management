import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { uploadStorage } from "@/lib/server/storage";

// GET /api/tax-return/documents/[id]/file … 証明書のファイルの配信。
// 自テナントの書類か確かめてから配信する（/api/uploads/[filename] と同じヘッダー）。?download=1 で保存用
export const GET = withApi({
  role: "viewer",
  handler: async ({ req, user, db, id, audit }) => {
    const doc = await db.taxDocument.findFirst({ where: { id } });
    if (!doc) throw notFound();
    const bytes = await uploadStorage().get(user.tenantId, doc.savedName);
    if (!bytes) throw notFound();
    // 証明書は税務書類のため、取得も記録する
    await audit("tax_document_download", `tax_document:${doc.id}`);
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  },
});
