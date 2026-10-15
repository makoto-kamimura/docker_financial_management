import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { readUploadedFile, storeTenantUpload } from "@/lib/server/upload";
import {
  loadSelfMedicationReceipts,
  loadTaxDocuments,
  TAX_DOCUMENT_SELECT,
  taxDocumentFileUrl,
} from "@/lib/tax/documents";

// 控除・確定申告の書類のファイル。証明書（源泉徴収票・控除証明書など）の画像・PDF と、
// セルフメディケーション税制の対象のレシート（現金の明細の証憑。撮影時に対象の額を残したもの）。

const Year = z.coerce.number().int().min(2000).max(2100);
/** 書類の id（lib/shared/tax-estimate.ts の documents の id。英数字） */
const DocId = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/);

// GET /api/tax-return/documents?year= … その年の証明書と、セルフメディケーションのレシートの一覧
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: Year }),
  handler: async ({ user, db, query }) => {
    const [documents, selfMedicationReceipts] = await Promise.all([
      loadTaxDocuments(db, query.year),
      loadSelfMedicationReceipts(db, user.tenantId, query.year),
    ]);
    return NextResponse.json({ data: { documents, selfMedicationReceipts } });
  },
});

// POST /api/tax-return/documents … 証明書のアップロード（multipart: year・docId・file。画像か PDF。editor 以上）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, audit }) => {
    const upload = await readUploadedFile(req);
    const year = Year.safeParse(upload.form?.get("year"));
    const docId = DocId.safeParse(upload.form?.get("docId"));
    if (!year.success || !docId.success) throw badRequest("year と docId は必須です");
    const stored = await storeTenantUpload(user.tenantId, upload);
    const doc = await db.taxDocument.create({
      data: {
        tenantId: user.tenantId,
        taxYear: year.data,
        docId: docId.data,
        fileName: stored.fileName,
        savedName: stored.savedName,
        mimeType: stored.mimeType,
        fileType: stored.fileType,
        fileSize: stored.fileSize,
      },
      select: TAX_DOCUMENT_SELECT,
    });
    await audit("upload_tax_document", `tax_document:${doc.id}`, {
      after: { taxYear: doc.taxYear, docId: doc.docId },
    });
    return NextResponse.json(
      { data: { ...doc, fileUrl: taxDocumentFileUrl(doc.id) } },
      { status: 201 },
    );
  },
});
