import type { TenantDbClient } from "@/lib/tenant-db";
import { ApiError } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";
import { JOURNAL_DETAILS_INCLUDE, syncJournalToFinancialRecords } from "@/lib/journal";

// 売掛金・買掛金の発生・消込に使う既定科目コード
export const AR_ACCOUNT_CODE = "1300"; // 売掛金
export const AP_ACCOUNT_CODE = "3000"; // 買掛金
export const DEFAULT_PAYMENT_ACCOUNT_CODE = "1100"; // 普通預金
export const DEFAULT_RECEIVABLE_REVENUE_ACCOUNT_CODE = "4000"; // 売上高（売掛金発生の相手科目）
export const DEFAULT_PAYABLE_EXPENSE_ACCOUNT_CODE = "5000"; // 仕入高（買掛金発生の相手科目）

// 売掛・買掛の発生額を対応科目（1300 / 3000）の実績へ連動記帳する。
// 対応科目が存在しないテナント（家計モードのみ等）では何もしない。
//
// D-5d-2: 監査証跡として複式仕訳（Dr 売掛金/Cr 売上高 または Dr 仕入高/Cr 買掛金）も併せて記録する
// （相手科目（4000/5000）が見つかる場合のみ）。この仕訳は syncJournalToFinancialRecords（choke-point）
// を呼ばない ＝ 請求書・仕入発生の時点で売上高/仕入高を FinancialRecord（KPI・決算書・e-Tax）へ
// 計上する「発生主義での収益/費用認識」は本タスクのスコープ外とする決定による（ユーザー確認済み。
// 再設計タスク.md D-5d-2 の実装記録を参照）。目的はあくまで試算表・総勘定元帳に発生の仕訳を
// 残すことであり、FinancialRecord（売掛金/買掛金の残高スナップショット）の挙動は変えない。
export async function postIssueRecord(
  db: TenantDbClient,
  tenantId: number,
  direction: "receivable" | "payable",
  issueDate: Date,
  amount: number,
): Promise<void> {
  const accountCode = direction === "receivable" ? AR_ACCOUNT_CODE : AP_ACCOUNT_CODE;
  const counterAccountCode =
    direction === "receivable"
      ? DEFAULT_RECEIVABLE_REVENUE_ACCOUNT_CODE
      : DEFAULT_PAYABLE_EXPENSE_ACCOUNT_CODE;

  const account = await db.account.findFirst({ where: { tenantId, code: accountCode } });
  if (!account) return;

  const period = await resolvePeriodForDate(db, tenantId, issueDate);
  await db.financialRecord.create({
    data: { tenantId, accountId: account.id, periodId: period.id, amount },
  });

  const counterAccount = await db.account.findFirst({
    where: { tenantId, code: counterAccountCode },
  });
  if (!counterAccount) return;

  const [debitId, creditId] =
    direction === "receivable" ? [account.id, counterAccount.id] : [counterAccount.id, account.id];

  await db.journalEntry.create({
    data: {
      tenantId,
      transactionDate: issueDate,
      description: direction === "receivable" ? "売掛金発生（自動仕訳）" : "買掛金発生（自動仕訳）",
      paymentMethod: "other",
      taxCategory: "taxable",
      details: {
        create: [
          { side: "debit", accountId: debitId, amount },
          { side: "credit", accountId: creditId, amount },
        ],
      },
    },
  });
}

// 消込の複式仕訳を作成する（receivables / payables の pay で共用）。
// direction:
//   "receipt" … 入金消込（借方 = 入金科目、貸方 = 売掛金）
//   "payment" … 支払消込（借方 = 買掛金、貸方 = 支払科目）
export async function createSettlementJournal(
  db: TenantDbClient,
  tenantId: number,
  opts: {
    paidOn: Date;
    amount: number;
    paymentAccountCode?: string;
    counterAccountCode: string; // 消し込む対象科目（1300 / 3000）
    description: string;
    direction: "receipt" | "payment";
    missingAccountsMessage: string; // 科目未整備時の 500 メッセージ
  },
): Promise<void> {
  const paymentCode = opts.paymentAccountCode ?? DEFAULT_PAYMENT_ACCOUNT_CODE;
  const [paymentAccount, counterAccount] = await Promise.all([
    db.account.findFirst({ where: { tenantId, code: paymentCode } }),
    db.account.findFirst({ where: { tenantId, code: opts.counterAccountCode } }),
  ]);
  if (!paymentAccount || !counterAccount) {
    throw new ApiError(500, opts.missingAccountsMessage);
  }

  const [debitId, creditId] =
    opts.direction === "receipt"
      ? [paymentAccount.id, counterAccount.id]
      : [counterAccount.id, paymentAccount.id];

  const entry = await db.journalEntry.create({
    data: {
      tenantId,
      transactionDate: opts.paidOn,
      description: opts.description,
      paymentMethod: paymentCode === DEFAULT_PAYMENT_ACCOUNT_CODE ? "bank" : "cash",
      taxCategory: "non_taxable",
      details: {
        create: [
          { side: "debit", accountId: debitId, amount: opts.amount },
          { side: "credit", accountId: creditId, amount: opts.amount },
        ],
      },
    },
    include: JOURNAL_DETAILS_INCLUDE,
  });

  // D-5c: choke-point 経由で月次実績へ同期する。消込は AR(1300)/AP(3000) と入金/支払科目
  // （現状いずれも ASSET/LIABILITY）のみで構成されるため現時点では no-op だが、将来 P/L 科目を
  // 挟む消込経路が増えても自動的に反映されるようにしておく。
  await syncJournalToFinancialRecords(
    db,
    tenantId,
    entry.id,
    entry.transactionDate,
    entry.details.map((d) => ({
      accountId: d.accountId,
      category: d.account.category,
      side: d.side,
      amount: Number(d.amount),
    })),
  );
}
