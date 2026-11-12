// レシートの読み取り（無料プランで、OCR サービスが無いとき）。web の中の Tesseract（wasm）で文字を読み、
// parse-receipt-text.ts で日付・店名・合計を拾う。外部には送らない。ふだんは OCR サービスで読む（local.ts）。
import path from "node:path";
import { createWorker, OEM } from "tesseract.js";
import { parseReceiptText } from "@/lib/ledger/receipt-scan/parse-receipt-text";
import { ReceiptScanError, normalizeDraft, type ScanResult } from "@/lib/ledger/receipt-scan/types";

// 日本語の学習データ（@tesseract.js-data/jpn の LSTM 版）。実行時にダウンロードしない
const LANG_PATH = path.join(process.cwd(), "node_modules/@tesseract.js-data/jpn/4.0.0_best_int");
const TIMEOUT_MS = 60_000;

// 1 件の読み取りで数百 MB のメモリを使うので、同時に動かすのは 1 件だけにする
let queue: Promise<unknown> = Promise.resolve();

export async function scanWithTesseract(image: Buffer): Promise<ScanResult> {
  const text = await recognizeWithTesseract(image);
  return { draft: normalizeDraft(parseReceiptText(text)), model: "tesseract.js" };
}

/** 画像の文字を読む（同時に 1 件だけ。精度の評価 scripts/receipt-eval.ts でも使う） */
export function recognizeWithTesseract(image: Buffer): Promise<string> {
  const run = queue.then(() => recognize(image));
  queue = run.catch(() => undefined);
  return run;
}

async function recognize(image: Buffer): Promise<string> {
  const worker = await createWorker("jpn", OEM.LSTM_ONLY, {
    langPath: LANG_PATH,
    cacheMethod: "none",
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new ReceiptScanError("読み取りに時間がかかりすぎました。撮り直してみてください")),
        TIMEOUT_MS,
      );
    });
    const { data } = await Promise.race([worker.recognize(image), timeout]);
    return data.text;
  } catch (e) {
    if (e instanceof ReceiptScanError) throw e;
    console.error("[receipt-scan] tesseract failed:", e);
    throw new ReceiptScanError("この画像は読み取れません。撮り直してみてください");
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
