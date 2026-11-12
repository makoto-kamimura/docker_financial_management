// レシートの OCR サービス（app/ocr。compose の中の別のコンテナ）を呼ぶ。
// レシートを写真から切り抜いて（台形補正）PaddleOCR で読み、行ごとの文字と位置・画質を返す。
// 外部には送らない。サービスに届かないときは OcrServiceUnavailable（呼び出し側が Tesseract で読み直す）。
import { ReceiptScanError } from "@/lib/ledger/receipt-scan/types";

/** 読み取った 1 行。位置は読み取りに使った画像（切り抜き・回転のあと）の画素 */
export type OcrLine = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 文字の高さ（店名・合計は大きい字で印字されることが多い） */
  height: number;
  /** 行の中で一番低い、読み取りの自信（0〜1） */
  score: number;
};

/** 画質の警告（撮り直しの案内に使う） */
export type QualityWarning =
  | "low_resolution"
  | "blurry"
  | "too_dark"
  | "too_bright"
  | "uneven_lighting";

export type OcrReading = {
  width: number;
  height: number;
  /** レシートを見つけて切り抜いたか */
  cropped: boolean;
  /** 横向きの写真を何度回して読んだか */
  rotation: number;
  quality: { warnings: QualityWarning[] } & Record<string, unknown>;
  lines: OcrLine[];
  text: string;
  /** 使ったモデル（記録用） */
  model?: string;
  /** 切り抜いた画像（JPEG の base64。image: true のときだけ） */
  image?: string;
};

/** OCR サービスに届かない（止まっている・まだ起動していない） */
export class OcrServiceUnavailable extends Error {
  constructor(cause: unknown) {
    super(`receipt OCR service unavailable: ${cause instanceof Error ? cause.message : cause}`);
    this.name = "OcrServiceUnavailable";
  }
}

// サービス側の読み取りの時間切れ（60 秒）と、空きを待つ時間（60 秒）より少し長く待つ
const TIMEOUT_MS = 130_000;

export async function readWithOcrService(
  baseUrl: string,
  image: Buffer,
  opts: { ocr?: boolean; image?: boolean; timeoutMs?: number } = {},
): Promise<OcrReading> {
  const url = new URL("/v1/receipt", baseUrl);
  url.searchParams.set("ocr", opts.ocr === false ? "0" : "1");
  url.searchParams.set("image", opts.image ? "1" : "0");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new ReceiptScanError("読み取りに時間がかかりすぎました。撮り直してみてください");
    }
    throw new OcrServiceUnavailable(e);
  }
  if (res.ok) return (await res.json()) as OcrReading;

  const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  if (res.status === 422 || res.status === 413) {
    throw new ReceiptScanError("この画像は読み取れません。撮り直してみてください");
  }
  if (res.status === 503) {
    throw new ReceiptScanError("読み取りが混み合っています。少し待ってからお試しください", 503);
  }
  if (res.status === 504) {
    throw new ReceiptScanError("読み取りに時間がかかりすぎました。撮り直してみてください");
  }
  console.error(`[receipt-scan] ocr service failed: ${res.status} ${code ?? ""}`);
  throw new ReceiptScanError("レシートを読み取れませんでした。撮り直してみてください");
}
