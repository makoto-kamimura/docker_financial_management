// レシートの読み取り（無料プラン）。サーバーの中で読み、外部には送らない。
// OCR サービス（RECEIPT_OCR_URL）があれば、レシートを切り抜いて PaddleOCR で読む。
// サービスが無い・届かないときは、web の中の Tesseract で読む（精度は落ちる）。
import { parseReceiptLines } from "@/lib/ledger/receipt-scan/parse-receipt-text";
import {
  OcrServiceUnavailable,
  readWithOcrService,
  type OcrReading,
} from "@/lib/ledger/receipt-scan/ocr-service";
import { scanWithTesseract } from "@/lib/ledger/receipt-scan/tesseract";
import {
  normalizeDraft,
  type ReceiptDraft,
  type ScanResult,
} from "@/lib/ledger/receipt-scan/types";

export async function scanLocally(image: Buffer, ocrUrl: string | undefined): Promise<ScanResult> {
  if (ocrUrl) {
    try {
      const reading = await readWithOcrService(ocrUrl, image);
      return {
        draft: draftFromReading(reading),
        model: reading.model ?? "pp-ocr",
        warnings: reading.quality.warnings,
      };
    } catch (e) {
      if (!(e instanceof OcrServiceUnavailable)) throw e;
      console.warn(`[receipt-scan] ${e.message}; falling back to tesseract.js`);
    }
  }
  return scanWithTesseract(image);
}

/** OCR サービスの読み取り結果から下書きを作る（行の文字の高さも、店名・合計の手がかりにする） */
export function draftFromReading(reading: OcrReading): ReceiptDraft {
  return normalizeDraft(parseReceiptLines(reading.lines));
}
