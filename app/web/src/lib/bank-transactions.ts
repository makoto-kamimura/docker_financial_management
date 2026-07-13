import type { TenantDb } from "@/lib/tenant-db";
import type { TxnSource } from "@prisma/client";

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
// `@@unique([accountId, externalId])` により重複行は upsert(update:{}) で無視される。
export async function upsertExternalTransactions(
  db: TenantDb,
  accountId: number,
  rows: ExternalTransactionRow[],
  source: Extract<TxnSource, "CSV" | "SYNC">,
): Promise<number> {
  let processed = 0;
  for (const r of rows) {
    await db.bankTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: r.externalId } },
      update: {},
      create: {
        accountId,
        date: new Date(r.date),
        description: r.description,
        amount: r.amount,
        balance: r.balance ?? null,
        source,
        externalId: r.externalId,
      },
    });
    processed++;
  }
  return processed;
}
