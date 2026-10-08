import type { TenantDbClient } from "@/lib/server/tenant-db";
import { conflict } from "@/lib/server/api-error";

// 確定済みの月の予算は書き換えさせない（予実対比の基準として固定するため）。
// 予算を書き込むルート（登録・変更・削除・CSV 取込・配分の反映）から呼ぶ。

export const BUDGET_LOCKED_MESSAGE =
  "この月の予算は確定済みのため変更できません。変更するには、予算管理の「予算の確定」で確定を解除してください";

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

// ── 実績の確定 ──────────────────────────────────────────────
// 確定済みの月の実績（financial_records）は書き換えさせない（予実対比の実績側を固定するため）。
// 実績を書く経路（明細の登録・削除・科目の変更・振替やチャージの紐付け・仕訳の連動・債権債務の計上・
// 減価償却・棚卸）から呼ぶ。明細は科目を付けるとそのまま実績になるため、確定済みの月の明細は変えられない
// （CSV・自動取得の取り込みでは、確定済みの月の行を飛ばす）。

export const ACTUALS_LOCKED_MESSAGE =
  "この月の実績は確定済みのため変更できません。変更するには、実績管理の「実績の確定」で確定を解除してください";

export async function isActualsPeriodConfirmed(
  db: Pick<TenantDbClient, "actualsConfirmation">,
  periodId: number,
): Promise<boolean> {
  const row = await db.actualsConfirmation.findUnique({ where: { periodId } });
  return row !== null;
}

/** 実績確定済みの periodId（渡したもののうち） */
export async function confirmedActualsPeriodIds(
  db: Pick<TenantDbClient, "actualsConfirmation">,
  periodIds: number[],
): Promise<Set<number>> {
  const ids = [...new Set(periodIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.actualsConfirmation.findMany({
    where: { periodId: { in: ids } },
    select: { periodId: true },
  });
  return new Set(rows.map((r) => r.periodId));
}

/** どれか 1 つでも実績確定済みの月なら 409 を throw する */
export async function assertActualsPeriodsEditable(
  db: Pick<TenantDbClient, "actualsConfirmation">,
  periodIds: number[],
): Promise<void> {
  if ((await confirmedActualsPeriodIds(db, periodIds)).size > 0) {
    throw conflict(ACTUALS_LOCKED_MESSAGE);
  }
}

/** 日付（その年・月）の実績が確定済みなら 409 を throw する。会計期間がまだ無ければ何もしない */
export async function assertActualsDateEditable(
  db: Pick<TenantDbClient, "period">,
  tenantId: number,
  date: Date,
): Promise<void> {
  const period = await db.period.findUnique({
    where: {
      tenantId_fiscalYear_month: {
        tenantId,
        fiscalYear: date.getFullYear(),
        month: date.getMonth() + 1,
      },
    },
    select: { actualsConfirmation: { select: { id: true } } },
  });
  if (period?.actualsConfirmation) throw conflict(ACTUALS_LOCKED_MESSAGE);
}
