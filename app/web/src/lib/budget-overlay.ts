import type { TenantDb } from "@/lib/tenant-db";
import { computeDebtSchedule, ymIndex } from "@/lib/debt-schedule";

// 予算への機械計上（オーバーレイ）の計算。Budget テーブルは書き換えず、
// 表示・提案時に加算する（budgets/route.ts から抽出。配分提案 API でも再利用する）。

export type LoanOverlayItem = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
};

export type PersonalAssetDebtOverlayItem = LoanOverlayItem & { assetName: string };

// 住宅ローンの月々の返済額を、連携先科目（例: 家賃）の予算に自動加算するための上乗せ額。
export async function computeHousingLoanOverlay(
  db: TenantDb,
  tenantId: number,
  year: number,
): Promise<LoanOverlayItem[]> {
  const housingLoans = await db.loan.findMany({
    where: {
      tenantId,
      loanType: "housing",
      linkedAccountId: { not: null },
      monthlyPayment: { not: null },
    },
    include: { linkedAccount: { select: { id: true, code: true } } },
  });

  const overlay: LoanOverlayItem[] = [];
  for (const loan of housingLoans) {
    if (!loan.linkedAccount || loan.monthlyPayment === null) continue;
    const startYm = loan.borrowedOn.getFullYear() * 12 + loan.borrowedOn.getMonth();
    const endYm = loan.repaymentDate.getFullYear() * 12 + loan.repaymentDate.getMonth();
    for (let month = 1; month <= 12; month++) {
      const ym = year * 12 + (month - 1);
      if (ym < startYm || ym > endYm) continue;
      overlay.push({
        accountId: loan.linkedAccount.id,
        accountCode: loan.linkedAccount.code,
        month,
        amount: Number(loan.monthlyPayment),
      });
    }
  }
  return overlay;
}

// 実物資産に紐付く負債（ローン等）の当初負債額を、支払い開始年月〜解消予定年月で均等割りし、
// 紐付け負債科目の予算に上乗せする額。
export async function computePersonalAssetDebtOverlay(
  db: TenantDb,
  tenantId: number,
  year: number,
): Promise<PersonalAssetDebtOverlayItem[]> {
  const assets = await db.personalAsset.findMany({
    where: {
      tenantId,
      linkedAccountId: { not: null },
      debtStartOn: { not: null },
      debtPayoffDue: { not: null },
      debtInitialAmount: { not: null },
    },
    include: { linkedAccount: { select: { id: true, code: true } } },
  });

  const overlay: PersonalAssetDebtOverlayItem[] = [];
  for (const asset of assets) {
    if (!asset.linkedAccount || !asset.debtStartOn || !asset.debtPayoffDue) continue;
    const schedule = computeDebtSchedule(
      Number(asset.debtInitialAmount),
      asset.debtStartOn,
      asset.debtPayoffDue,
    );
    if (!schedule) continue;

    const startYm = ymIndex(asset.debtStartOn);
    const payoffYm = ymIndex(asset.debtPayoffDue);
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
