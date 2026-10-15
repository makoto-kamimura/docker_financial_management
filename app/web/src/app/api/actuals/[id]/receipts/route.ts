import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { readUploadedFile, resolveReceiptFileUrl, storeTenantUpload } from "@/lib/server/upload";
import { CASH } from "@/lib/ledger/ledger-entries";
import { parseSelfMedicationFields } from "@/lib/tax/documents";

// 現金の明細の証憑（レシートの写真など）。撮影して読み取ったレシートを、登録した明細に残す。
// 証憑は金額を変えないので、実績を確定済みの月の明細にも付けられる。
// セルフメディケーション税制の対象の市販薬を含むレシートは、対象の額と品目も残す（控除・確定申告のページで一覧にする）。

const RECEIPT_SELECT = {
  id: true,
  fileName: true,
  savedName: true,
  fileUrl: true,
  fileType: true,
  uploadedAt: true,
  selfMedicationAmount: true,
  selfMedicationItems: true,
} as const;

const toReceipt = <
  R extends { savedName: string | null; fileUrl: string; selfMedicationAmount: unknown },
>(
  r: R,
) => ({
  ...r,
  fileUrl: resolveReceiptFileUrl(r),
  selfMedicationAmount: r.selfMedicationAmount === null ? null : Number(r.selfMedicationAmount),
});

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
    return NextResponse.json({ data: receipts.map(toReceipt) });
  },
});

// POST /api/actuals/[id]/receipts … 証憑のアップロード（multipart の file。editor 以上）
//   任意の selfMedicationAmount（円）・selfMedicationItems（[{ name, amount }] の JSON）で、
//   セルフメディケーション税制の対象の額と品目を残す
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const entry = await db.financialRecord.findFirst({ where: { id, ...CASH } });
    if (!entry) throw notFound();

    const upload = await readUploadedFile(req);
    const selfMedication = upload.form ? parseSelfMedicationFields(upload.form) : null;
    const receipt = await db.receipt.create({
      data: {
        financialRecordId: id,
        ...(await storeTenantUpload(user.tenantId, upload)),
        ...(selfMedication
          ? {
              selfMedicationAmount: selfMedication.amount,
              selfMedicationItems: selfMedication.items,
            }
          : {}),
      },
      select: RECEIPT_SELECT,
    });
    await audit("upload_receipt", `financial_record:${id}:receipt:${receipt.id}`);
    return NextResponse.json({ data: toReceipt(receipt) }, { status: 201 });
  },
});
