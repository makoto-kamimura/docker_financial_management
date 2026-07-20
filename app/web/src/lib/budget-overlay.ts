import type { TenantDb } from "@/lib/tenant-db";
import { annuityMonthlyPayment, computeDebtSchedule, ymIndex } from "@/lib/debt-schedule";

// 予算への機械計上（オーバーレイ）の計算。Budget テーブルは書き換えず、
// 表示・提案時に加算する（budgets/route.ts から抽出。配分提案 API でも再利用する）。

export type LoanOverlayItem = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
  /** manual = Loan.monthlyPayment の入力値、annuity = 元利均等の計算値 */
  source: "manual" | "annuity";
};

export type PersonalAssetDebtOverlayItem = Omit<LoanOverlayItem, "source"> & { assetName: string };

// 連携先科目（例: 家賃・借入返済）が設定された全ローン（住宅・事業性問わず）の月々の返済額を、
// その科目の予算に自動加算するための上乗せ額。monthlyPayment 入力済みはその値を優先し、
// 未入力は元利均等（annuityMonthlyPayment）で計算する。
export async function computeLoanOverlay(
  db: TenantDb,
  tenantId: number,
  year: number,
): Promise<LoanOverlayItem[]> {
  const loans = await db.loan.findMany({
    // D-4: 実物資産の紐付け負債（personalAsset あり）は computePersonalAssetDebtOverlay 側で
    // 資産名付きで計上するため、ここでは除外して二重計上を防ぐ
    where: { tenantId, linkedAccountId: { not: null }, personalAsset: { is: null } },
    include: { linkedAccount: { select: { id: true, code: true } } },
  });

  const overlay: LoanOverlayItem[] = [];
  for (const loan of loans) {
    if (!loan.linkedAccount) continue;
    const startYm = loan.borrowedOn.getFullYear() * 12 + loan.borrowedOn.getMonth();
    const endYm = loan.repaymentDate.getFullYear() * 12 + loan.repaymentDate.getMonth();
    const totalMonths = endYm - startYm + 1;
    if (totalMonths <= 0) continue;

    const manualAmount = loan.monthlyPayment !== null ? Number(loan.monthlyPayment) : null;
    const amount =
      manualAmount ??
      annuityMonthlyPayment(Number(loan.amount), Number(loan.interestRate), totalMonths);
    if (amount <= 0) continue;
    const source: LoanOverlayItem["source"] = manualAmount !== null ? "manual" : "annuity";

    for (let month = 1; month <= 12; month++) {
      const ym = year * 12 + (month - 1);
      if (ym < startYm || ym > endYm) continue;
      overlay.push({
        accountId: loan.linkedAccount.id,
        accountCode: loan.linkedAccount.code,
        month,
        amount,
        source,
      });
    }
  }
  return overlay;
}

// 後方互換のためのエイリアス（旧名: 住宅ローンのみ対象だったが、現在は全ローンを対象に計算する）。
export const computeHousingLoanOverlay = computeLoanOverlay;

// 実物資産に紐付く負債（D-4 で Loan に一本化。personal_assets.loanId 経由で参照）の
// 当初負債額を支払い開始年月〜解消予定年月で均等割りし、紐付け負債科目の予算に上乗せする額。
export async function computePersonalAssetDebtOverlay(
  db: TenantDb,
  tenantId: number,
  year: number,
): Promise<PersonalAssetDebtOverlayItem[]> {
  const assets = await db.personalAsset.findMany({
    where: { tenantId, linkedAccountId: { not: null }, loanId: { not: null } },
    include: { linkedAccount: { select: { id: true, code: true } }, loan: true },
  });

  const overlay: PersonalAssetDebtOverlayItem[] = [];
  for (const asset of assets) {
    if (!asset.linkedAccount || !asset.loan) continue;
    const schedule = computeDebtSchedule(
      Number(asset.loan.amount),
      asset.loan.borrowedOn,
      asset.loan.repaymentDate,
    );
    if (!schedule) continue;

    const startYm = ymIndex(asset.loan.borrowedOn);
    const payoffYm = ymIndex(asset.loan.repaymentDate);
    for (let month = 1; month <= 12; month++) {
      const ym = year * 12 + (month - 1);
      if (ym < startYm || ym > payoffYm) continue;
      overlay.push({
        accountId: asset.linkedAccount.id,
        accountCode: asset.linkedAccount.code,
        assetName: asset.name,
        month,
        amount: schedule.monthly,
      });
    }
  }
  return overlay;
}
