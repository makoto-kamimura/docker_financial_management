import type { TenantDbClient } from "@/lib/tenant-db";
import type { AccountCategoryValue } from "@/lib/account-category";
import { resolvePeriodForDate } from "@/lib/period";
import { assertActualsDateEditable, assertActualsPeriodsEditable } from "@/lib/budget-lock";

// 仕訳明細の共通 include（明細 + 科目、借方 → 貸方の順）。
// journals / actuals（カレンダー入力）の各ルートで共用する。
export const JOURNAL_DETAILS_INCLUDE = {
  details: {
    include: {
      account: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          soleName: true,
          corporateName: true,
        },
      },
    },
    orderBy: { side: "asc" as const },
  },
};

export type JournalDetailForSync = {
  accountId: number;
  category: AccountCategoryValue;
  side: string; // "debit" | "credit"（DB は素の String 列）
  amount: number;
};

// 借方が自然な増加側の科目カテゴリ（残りは貸方が自然な増加側）。
const NATURAL_DEBIT_CATEGORIES = new Set<AccountCategoryValue>(["ASSET", "EXPENSE", "COGS"]);

// FinancialRecord への同期対象から常に除外する科目カテゴリ。
// D-5b/§12.3: B/S 科目はスナップショット意味論（assets/summary）で運用されており、
// 複式仕訳のデルタとは構造的に異なるため sync 対象に含めない。
const BALANCE_SHEET_CATEGORIES = new Set<AccountCategoryValue>(["ASSET", "LIABILITY"]);

// D-5b の符号規約: 仕訳の side が科目の自然な増加側と一致すれば +amount、逆側なら -amount。
export function signedFinancialRecordAmount(detail: {
  category: AccountCategoryValue;
  side: string;
  amount: number;
}): number {
  const naturalSide = NATURAL_DEBIT_CATEGORIES.has(detail.category) ? "debit" : "credit";
  return detail.side === naturalSide ? detail.amount : -detail.amount;
}

/**
 * 入出金明細（現金・銀行・カード）に科目を付けたときの、実績としての符号付き金額。
 *
 * 仕訳を経由する場合は借方・貸方の入れ替えで符号が決まる（{@link signedFinancialRecordAmount}）が、
 * 明細は仕訳を経由せずにそのまま実績になるため、ここで同じ規約を再現する（lib/ledger-entries.ts の entryActualAmount）。
 * 収入科目に紐付いた出金明細（受け取った仕送りの返金など）はマイナスの収入として、同じ月の入金と相殺される。
 *
 * @param spendAmount 明細の金額を「支出が正」に正規化した値（明細の flow は出金が負なので `-flow`）
 */
export function signedActualAmountFromSpend(
  category: AccountCategoryValue,
  spendAmount: number,
): number {
  // 支出が正 ＝ 科目を借方に立てる向き。借方が自然な増加側の科目はそのまま、
  // 貸方が自然な増加側の科目（REVENUE など）は逆側なので符号を反転する。
  return NATURAL_DEBIT_CATEGORIES.has(category) ? spendAmount : -spendAmount;
}

// 仕訳明細を月次実績（financial_records）へ連動記帳する。
// 取引日から会計期間を解決し、P/L 科目（REVENUE/COGS/EXPENSE/PROFIT/OTHER）の明細を
// 符号規約どおりの符号付き金額で実績行として追加する。B/S 科目（ASSET/LIABILITY）は
// スナップショット意味論のため対象外（再設計詳細設計書.md §12.3）。
// D-5a: 生成した行には journalEntryId を刻む（削除時にたどって一緒に削除するため）。
export async function syncJournalToFinancialRecords(
  db: TenantDbClient,
  tenantId: number,
  journalEntryId: number,
  transactionDate: Date,
  details: JournalDetailForSync[],
): Promise<void> {
  const plDetails = details.filter((d) => !BALANCE_SHEET_CATEGORIES.has(d.category));
  if (plDetails.length === 0) return;

  const period = await resolvePeriodForDate(db, tenantId, transactionDate);
  await assertActualsPeriodsEditable(db, [period.id]);

  await db.financialRecord.createMany({
    data: plDetails.map((d) => ({
      tenantId,
      accountId: d.accountId,
      periodId: period.id,
      amount: signedFinancialRecordAmount(d),
      journalEntryId,
    })),
  });
}

// 仕訳を作る前の確認: P/L 科目を含む仕訳で、取引日の月の実績が確定済みなら 409。
// syncJournalToFinancialRecords でも同じ判定をするが、仕訳を先に作ってから止めると
// 実績に反映されない仕訳だけが残るため、仕訳を作るルートでは作成前にこれを呼ぶ。
export async function assertJournalSyncAllowed(
  db: TenantDbClient,
  tenantId: number,
  transactionDate: Date,
  accountIds: number[],
): Promise<void> {
  const accounts = await db.account.findMany({
    where: { tenantId, id: { in: [...new Set(accountIds)] } },
    select: { category: true },
  });
  if (accounts.every((a) => BALANCE_SHEET_CATEGORIES.has(a.category as AccountCategoryValue))) {
    return;
  }
  await assertActualsDateEditable(db, tenantId, transactionDate);
}

// 仕訳削除時、同期済み（journalEntryId が一致する）FinancialRecord 行も一緒に削除する。
// D-5a: これを呼ばずに db.journalEntry.delete() だけを行うと、FK は ON DELETE SET NULL の
// ため行自体は残ってしまい、発生元をたどれない孤立行になる（旧バグ）。
export async function deleteFinancialRecordsForJournalEntry(
  db: TenantDbClient,
  journalEntryId: number,
): Promise<void> {
  const synced = await db.financialRecord.findMany({
    where: { journalEntryId },
    select: { periodId: true },
  });
  if (synced.length === 0) return;
  await assertActualsPeriodsEditable(
    db,
    synced.map((r) => r.periodId),
  );
  await db.financialRecord.deleteMany({ where: { journalEntryId } });
}
