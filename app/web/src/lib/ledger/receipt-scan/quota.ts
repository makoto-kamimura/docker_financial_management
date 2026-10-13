// レシートの読み取りのエンジンの選び方と、1 日の回数の上限。
// 有料プランは Claude（高精度）、無料プランはサーバーの中の Tesseract（簡易）で読む。
// 回数はテナントごとに日本時間の 1 日で数え、失敗した回は数えない。
import { Env } from "@/lib/server/config-schema";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { DEFAULT_RECEIPT_MODEL } from "@/lib/ledger/receipt-scan/claude";
import type { ReceiptEngine } from "@/lib/ledger/receipt-scan/types";

/** テナントあたり 1 日の上限（Tesseract はサーバーの CPU とメモリを守るため） */
export const DAILY_LIMIT: Record<ReceiptEngine, number> = { claude: 30, tesseract: 30 };

const ScanEnv = Env.pick({
  ANTHROPIC_API_KEY: true,
  RECEIPT_OCR_MODEL: true,
  ANTHROPIC_BASE_URL: true,
});
export type ScanSettings = ReturnType<typeof ScanEnv.parse>;

// 課金の設定と同じく、呼ぶたびに読む（結合テストで設定の有無を切り替えられるように）
export function scanSettings(): ScanSettings {
  return ScanEnv.parse(process.env);
}

export function receiptModel(s: ScanSettings = scanSettings()): string {
  return s.RECEIPT_OCR_MODEL ?? DEFAULT_RECEIPT_MODEL;
}

/** Claude で読めるか（API キーがあるか） */
export function claudeAvailable(s: ScanSettings = scanSettings()): boolean {
  return Boolean(s.ANTHROPIC_API_KEY);
}

/** 使うエンジン。有料プランでも、API キーが無ければ Tesseract で読む */
export function engineFor(premium: boolean, s: ScanSettings = scanSettings()): ReceiptEngine {
  return premium && claudeAvailable(s) ? "claude" : "tesseract";
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間で、その日の 0 時（UTC の Date） */
export function startOfTokyoDay(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS,
  );
}

/** 今日（日本時間）の読み取りの回数。失敗した回は数えない */
export function countScansToday(db: TenantDbClient, now: Date = new Date()): Promise<number> {
  return db.receiptScanRequest.count({
    where: { createdAt: { gte: startOfTokyoDay(now) }, status: { not: "FAILED" } },
  });
}
