import type { TenantDb } from "@/lib/tenant-db";
import { resolvePeriodForDate } from "@/lib/period";

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

// 仕訳明細を月次実績（financial_records）へ連動記帳する。
// 取引日から会計期間を解決し、明細の科目×金額をそのまま実績行として追加する。
export async function syncJournalToFinancialRecords(
  db: TenantDb,
  tenantId: number,
  transactionDate: Date,
  details: { accountId: number; amount: number }[],
): Promise<void> {
  const period = await resolvePeriodForDate(db, tenantId, transactionDate);

  await db.financialRecord.createMany({
    data: details.map((d) => ({
      tenantId,
      accountId: d.accountId,
      periodId: period.id,
      amount: d.amount,
    })),
  });
}
