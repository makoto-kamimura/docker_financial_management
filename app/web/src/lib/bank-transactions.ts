import type { TenantDb } from "@/lib/tenant-db";
import type { TxnSource } from "@prisma/client";
import { classifyByRules } from "@/lib/banktxn-import";

// Decimal 型の金額・残高を number へ整形する（API レスポンス用）
export function serializeBankTransaction<T extends { amount: unknown; balance: unknown }>(
  txn: T,
): Omit<T, "amount" | "balance"> & { amount: number; balance: number | null } {
  return {
    ...txn,
    amount: Number(txn.amount),
    balance: txn.balance ? Number(txn.balance) : null,
  };
}

export type ExternalTransactionRow = {
  externalId: string;
  date: string | Date;
  description: string;
  amount: number;
  balance?: number | null;
};

// 外部由来（CSV 取込・自動同期）の明細を登録する。
// S-11: 1 件ずつの upsert 直列実行（N+1）を一括 createMany + skipDuplicates に置換。
// `@@unique([accountId, externalId])` により重複行は自動的にスキップされる（維持）。
// 摘要が txn_category_rules に一致する場合は categoryAccountId を自動で埋める
// （転記は行わない。人の操作による POST /categorize でのみ実績へ転記する）。
// 返り値は実際に新規作成された件数（重複でスキップされた行は含まない）。
export async function upsertExternalTransactions(
  db: TenantDb,
  accountId: number,
  rows: ExternalTransactionRow[],
  source: Extract<TxnSource, "CSV" | "SYNC">,
): Promise<number> {
  if (rows.length === 0) return 0;

  const rules = await db.txnCategoryRule.findMany({
    select: { keyword: true, categoryAccountId: true, priority: true },
  });

  const { count } = await db.bankTransaction.createMany({
    data: rows.map((r) => ({
      accountId,
      date: new Date(r.date),
      description: r.description,
      amount: r.amount,
      balance: r.balance ?? null,
      source,
      externalId: r.externalId,
      categoryAccountId: classifyByRules(r.description, rules),
    })),
    skipDuplicates: true,
  });
  return count;
}
