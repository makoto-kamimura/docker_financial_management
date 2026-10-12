import { invalidateCache } from "@/lib/server/redis";

// 決算書（GET /api/closing/statements）と総勘定元帳（GET /api/reports/general-ledger）のキャッシュを、
// テナントと年で消す。キーは各ルートの withCache と同じ形にそろえる（tenantId を必ず含める）。
// 仕訳の登録・削除と決算の確定から呼ぶ。
export async function invalidateClosingCaches(tenantId: number, year: number): Promise<void> {
  await invalidateCache(`closing:statements:${tenantId}:${year}`);
  await invalidateCache(`closing:statements:${tenantId}:${year}:dept:*`);
  await invalidateCache(`reports:ledger:${tenantId}:${year}:*`);
}
