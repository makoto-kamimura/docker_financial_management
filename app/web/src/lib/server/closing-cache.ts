import { invalidateCache } from "@/lib/server/redis";

// 決算書（GET /api/closing/statements）と総勘定元帳（GET /api/reports/general-ledger）のキャッシュを、
// テナントと年で消す。キーは各ルートの withCache と同じ形にそろえる（tenantId を必ず含める）。
// 仕訳の登録・削除と決算の確定から呼ぶ。決算書のキーは年のあとに範囲（household / business）が付く。
export async function invalidateClosingCaches(tenantId: number, year: number): Promise<void> {
  await invalidateCache(`closing:statements:${tenantId}:${year}:*`);
  await invalidateCache(`reports:ledger:${tenantId}:${year}:*`);
}

// 明細（現金・銀行・カード）の登録・削除・科目や事業利用の変更・取り込みで、決算書のキャッシュを消す。
// 明細はどの年にも入りうるので、テナントの全年を消す。
export async function invalidateActualsCaches(tenantId: number): Promise<void> {
  await invalidateCache(`closing:statements:${tenantId}:*`);
}
