import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import {
  classifyFileType,
  contentTypeForExtension,
  matchesMagicBytes,
  maxUploadBytes,
  resolveUploadExtension,
  uploadTooLargeMessage,
} from "@/lib/server/upload";
import { receiptScanStatus, scanReceipt } from "@/lib/ledger/receipt-scan/scan";
import type { ClaudeImageType } from "@/lib/ledger/receipt-scan/claude";

// レシートの読み取り（実績管理の現金の入力）。撮った画像から日付・店名・合計を読み、下書きを返す。
// ここでは何も登録しない（利用者が確かめてから POST /api/actuals で登録する）。画像も残さない。
// 有料プランは Claude、無料プランはサーバーの中の Tesseract で読む（lib/ledger/receipt-scan/）。

// GET /api/actuals/receipt-scan … 使うエンジン・プラン・今日の残りの回数
export const GET = withApi({
  role: "viewer",
  handler: async ({ db }) => NextResponse.json({ data: await receiptScanStatus(db) }),
});

// POST /api/actuals/receipt-scan … 画像（multipart の file）を読み取って下書きを返す
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, audit }) => {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw badRequest(uploadTooLargeMessage());
    }
    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("file is required");
    if (file.size > maxUploadBytes()) throw badRequest(uploadTooLargeMessage());

    const ext = resolveUploadExtension(file.name, file.type);
    const mediaType = ext ? contentTypeForExtension(ext) : "";
    if (!ext || classifyFileType(mediaType) !== "image") {
      throw badRequest("画像（jpg/png/gif/webp）を送ってください");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!matchesMagicBytes(buf, ext)) throw badRequest("ファイルの内容が拡張子と一致しません");

    const outcome = await scanReceipt(db, user, buf, mediaType as ClaudeImageType);
    await audit("receipt_scan", `receipt_scan_request:${outcome.requestId}`);
    const { draft, engine, remaining, suggestedAccount } = outcome;
    return NextResponse.json({ data: { draft, engine, remaining, suggestedAccount } });
  },
});
