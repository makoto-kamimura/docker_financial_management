import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { readUploadedFile, resolveReceiptFileUrl, storeTenantUpload } from "@/lib/server/upload";
import { CASH } from "@/lib/ledger/ledger-entries";

// 現金の明細の証憑（レシートの写真など）。撮影して読み取ったレシートを、登録した明細に残す。
// 証憑は金額を変えないので、実績を確定済みの月の明細にも付けられる。

const RECEIPT_SELECT = {
  id: true,
  fileName: true,
  savedName: true,
  fileUrl: true,
  fileType: true,
  uploadedAt: true,
} as const;

// GET /api/actuals/[id]/receipts … 証憑の一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ db, id }) => {
    const entry = await db.financialRecord.findFirst({ where: { id, ...CASH } });
    if (!entry) throw notFound();
    const receipts = await db.receipt.findMany({
      where: { financialRecordId: id },
      select: RECEIPT_SELECT,
      orderBy: { uploadedAt: "asc" },
    });
    return NextResponse.json({
      data: receipts.map((r) => ({ ...r, fileUrl: resolveReceiptFileUrl(r) })),
    });
  },
});

// POST /api/actuals/[id]/receipts … 証憑のアップロード（multipart の file。editor 以上）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const entry = await db.financialRecord.findFirst({ where: { id, ...CASH } });
    if (!entry) throw notFound();

    const upload = await readUploadedFile(req);
    const receipt = await db.receipt.create({
      data: { financialRecordId: id, ...(await storeTenantUpload(user.tenantId, upload)) },
      select: RECEIPT_SELECT,
    });
    await audit("upload_receipt", `financial_record:${id}:receipt:${receipt.id}`);
    return NextResponse.json(
      { data: { ...receipt, fileUrl: resolveReceiptFileUrl(receipt) } },
      { status: 201 },
    );
  },
});
