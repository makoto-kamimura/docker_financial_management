import type { TenantDb } from "@/lib/tenant-db";
import type { TxnSource } from "@prisma/client";
import { classifyByRules } from "@/lib/banktxn-import";
import { resolveTransferTarget } from "@/lib/card-transfer";

// Decimal 型の金額を number へ整形する（API レスポンス用）。
// bank-transactions.ts の serializeBankTransaction と異なり balance を持たない。
export function serializeCardTransaction<T extends { amount: unknown }>(
  txn: T,
): Omit<T, "amount"> & { amount: number } {
  return {
    ...txn,
    amount: Number(txn.amount),
  };
}

export type ExternalCardTransactionRow = {
  externalId: string;
  date: string | Date;
  description: string;
  amount: number;
};

// 外部由来（CSV 取込）のカード利用明細を登録する。bank-transactions.ts の
// upsertExternalTransactions と同構造（銀行側の仕様・挙動は変更しない）。
// `@@unique([accountId, externalId])` により重複行は自動的にスキップされる。
// 摘要が txn_category_rules に一致する場合は categoryAccountId を自動で埋める
// （転記は行わない。人の操作による POST /categorize でのみ実績へ転記する）。
// 学習ルールは銀行明細と共有する（tenant 単位のキーワードルールのため）。
// 返り値は実際に新規作成された件数（重複でスキップされた行は含まない）。
//
// CSV は銀行明細と同じ「支出は負・入金は正」の生の明細形式で受け取る（実際のカード会社・
// ウォレットのエクスポートがこの形式のため）。card_transactions の保存規約は逆
// （+利用（支出） / -返金）なので、ここで符号を反転させて格納する。
export async function upsertExternalCardTransactions(
  db: TenantDb,
  accountId: number,
  rows: ExternalCardTransactionRow[],
  source: Extract<TxnSource, "CSV" | "SYNC">,
): Promise<number> {
  if (rows.length === 0) return 0;

  const [rules, transferRules] = await Promise.all([
    db.txnCategoryRule.findMany({
      select: { keyword: true, categoryAccountId: true, priority: true },
    }),
    // チャージ判定は取り込む先のカードに紐付いたルールだけを見る
    // （同じ摘要が別のカードでは通常の利用を指すことがあるため）
    db.cardTransferRule.findMany({
      where: { accountId },
      select: { keyword: true, transferToAccountId: true },
    }),
  ]);

  const { count } = await db.cardTransaction.createMany({
    data: rows.map((r) => {
      // チャージ（資金移動）と判定した行は支出ではないので科目を付けない
      const transferToAccountId = resolveTransferTarget(r.description, transferRules);
      return {
        accountId,
        date: new Date(r.date),
        description: r.description,
        amount: -r.amount,
        source,
        externalId: r.externalId,
        categoryAccountId:
          transferToAccountId === null ? classifyByRules(r.description, rules) : null,
        transferToAccountId,
      };
    }),
    skipDuplicates: true,
  });
  return count;
}
