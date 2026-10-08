import type { TenantDbClient } from "@/lib/tenant-db";
import { loadActualsCoverage, type CoverageSnapshot } from "@/lib/actuals-coverage";
import { nextYearMonth, prevYearMonth } from "@/lib/budget-cycle";

// 月ごとの流れ「① 予算確定 → ② 実績確定 → ③ 翌月の予算確定」の状況。
// 予算管理の「予算の確定」（GET /api/budgets/variance）、実績管理の「実績の確定」と
// ダッシュボードの状況の 1 行（GET /api/cycle-status）が同じものを使う。
export async function loadCycleStatus(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  month: number,
) {
  const next = nextYearMonth(year, month);
  const prev = prevYearMonth(year, month);
  const periodOf = (y: number, m: number) =>
    db.period.findUnique({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: y, month: m } },
      include: { budgetConfirmation: true, actualsConfirmation: true },
    });

  const [period, nextPeriod, prevPeriod, coverage] = await Promise.all([
    periodOf(year, month),
    periodOf(next.year, next.month),
    periodOf(prev.year, prev.month),
    loadActualsCoverage(db, tenantId, year, month),
  ]);

  return {
    periodId: period?.id ?? null,
    nextPeriodId: nextPeriod?.id ?? null,
    status: {
      year,
      month,
      next,
      /** ① その月の予算の確定日時 */
      confirmedAt: period?.budgetConfirmation?.confirmedAt ?? null,
      /** ③ 翌月の予算の確定日時 */
      nextConfirmedAt: nextPeriod?.budgetConfirmation?.confirmedAt ?? null,
      // 前月の予算が確定済みで実績が未確定なら、その月の予算はまだ確定できない
      prevActualsPending: !!prevPeriod?.budgetConfirmation && !prevPeriod.actualsConfirmation,
      /** ② その月の実績の入力状況と確定状況 */
      actuals: {
        confirmedAt: period?.actualsConfirmation?.confirmedAt ?? null,
        entered: coverage.entered,
        coveredThrough: coverage.coveredThrough,
        monthEnd: coverage.monthEnd,
        sources: coverage.sources,
        lagging: coverage.lagging,
        unassigned: coverage.unassigned,
        /** 確定時点の記録（口座・カードごとの最終日と「当月末まで変動なし」の印） */
        confirmedCoverage:
          (period?.actualsConfirmation?.coverage as CoverageSnapshot | null | undefined) ?? null,
      },
    },
  };
}

export type CycleStatus = Awaited<ReturnType<typeof loadCycleStatus>>["status"];

/** 最後に実績を確定した月（"YYYY-MM"）。一度も確定していなければ null */
export async function loadLastActualsConfirmed(
  db: TenantDbClient,
  tenantId: number,
): Promise<string | null> {
  const row = await db.actualsConfirmation.findFirst({
    where: { tenantId },
    orderBy: [{ period: { fiscalYear: "desc" } }, { period: { month: "desc" } }],
    select: { period: { select: { fiscalYear: true, month: true } } },
  });
  return row ? `${row.period.fiscalYear}-${String(row.period.month).padStart(2, "0")}` : null;
}
