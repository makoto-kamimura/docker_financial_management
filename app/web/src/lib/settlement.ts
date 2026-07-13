import type { TenantDb } from "@/lib/tenant-db";
import { ApiError } from "@/lib/api-error";
import { resolvePeriodForDate } from "@/lib/period";

// 売掛金・買掛金の発生・消込に使う既定科目コード
export const AR_ACCOUNT_CODE = "1300"; // 売掛金
export const AP_ACCOUNT_CODE = "3000"; // 買掛金
export const DEFAULT_PAYMENT_ACCOUNT_CODE = "1100"; // 普通預金

// 売掛・買掛の発生額を対応科目（1300 / 3000）の実績へ連動記帳する。
// 対応科目が存在しないテナント（家計モードのみ等）では何もしない。
export async function postIssueRecord(
  db: TenantDb,
  tenantId: number,
  accountCode: string,
  issueDate: Date,
  amount: number,
): Promise<void> {
  const account = await db.account.findFirst({ where: { tenantId, code: accountCode } });
  if (!account) return;

  const period = await resolvePeriodForDate(db, tenantId, issueDate);
  await db.financialRecord.create({
    data: { tenantId, accountId: account.id, periodId: period.id, amount },
  });
}

// 消込の複式仕訳を作成する（receivables / payables の pay で共用）。
// direction:
//   "receipt" … 入金消込（借方 = 入金科目、貸方 = 売掛金）
//   "payment" … 支払消込（借方 = 買掛金、貸方 = 支払科目）
export async function createSettlementJournal(
  db: TenantDb,
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

  await db.journalEntry.create({
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
  });
}
