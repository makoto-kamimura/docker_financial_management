import type { TenantDbClient } from "@/lib/tenant-db";
import { conflict } from "@/lib/api-error";

// 確定済みの月の予算は書き換えさせない（予実対比の基準として固定するため）。
// 予算を書き込むルート（登録・変更・削除・CSV 取込・配分の反映）から呼ぶ。

export const BUDGET_LOCKED_MESSAGE =
  "この月の予算は確定済みのため変更できません。変更するには、予実と確定タブで確定を解除してください";

export async function isBudgetPeriodConfirmed(
  db: Pick<TenantDbClient, "budgetConfirmation">,
  periodId: number,
): Promise<boolean> {
  const row = await db.budgetConfirmation.findUnique({ where: { periodId } });
  return row !== null;
}

/** 確定済みの月なら 409 を throw する */
export async function assertBudgetPeriodEditable(
  db: Pick<TenantDbClient, "budgetConfirmation">,
  periodId: number,
  label?: string,
): Promise<void> {
  if (await isBudgetPeriodConfirmed(db, periodId)) {
    throw conflict(label ? `${label}: ${BUDGET_LOCKED_MESSAGE}` : BUDGET_LOCKED_MESSAGE);
  }
}

/** 指定年度の確定済みの月（1〜12） */
export async function confirmedBudgetMonths(
  db: Pick<TenantDbClient, "budgetConfirmation">,
  year: number,
): Promise<{ month: number; confirmedAt: Date }[]> {
  const rows = await db.budgetConfirmation.findMany({
    where: { period: { fiscalYear: year } },
    select: { confirmedAt: true, period: { select: { month: true } } },
    orderBy: { period: { month: "asc" } },
  });
  return rows.map((r) => ({ month: r.period.month, confirmedAt: r.confirmedAt }));
}
