import type { BudgetScope } from "@prisma/client";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { loadActualsCoverage, type CoverageSnapshot } from "@/lib/ledger/actuals-coverage";
import { nextYearMonth, prevYearMonth } from "@/lib/shared/budget-cycle";

// 月ごとの流れ「① 予算確定 → ② 実績確定 → ③ 翌月の予算確定」の状況。
// 予算管理の「予算の確定」（GET /api/budgets/variance）、実績管理の「実績の確定」と
// ダッシュボードの状況の 1 行（GET /api/cycle-status）が同じものを使う。
// 前月の予算が確定済みなら、前月の実績も確定済みでないと予算を確定できない（POST /api/budgets/confirm と同じ判定）。
// 予算の確定は範囲（家庭 / 事業）ごとに見る。実績の確定は共通。
export async function loadCycleStatus(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  month: number,
  scope: BudgetScope = "HOUSEHOLD",
) {
  const next = nextYearMonth(year, month);
  const prev = prevYearMonth(year, month);
  const periodOf = (y: number, m: number) =>
    db.period.findUnique({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: y, month: m } },
      include: { budgetConfirmations: { where: { scope } }, actualsConfirmation: true },
    });

  const [period, nextPeriod, prevPeriod, coverage] = await Promise.all([
    periodOf(year, month),
    periodOf(next.year, next.month),
    periodOf(prev.year, prev.month),
    loadActualsCoverage(db, tenantId, year, month),
  ]);
  // その月に実績（financial_records）が 1 件でもあるか。初回の予算の確定（前月も当月も実績なし）の判定に使う
  const recorded = period
    ? (await db.financialRecord.findFirst({
        where: { tenantId, periodId: period.id },
        select: { id: true },
      })) !== null
    : false;

  return {
    periodId: period?.id ?? null,
    nextPeriodId: nextPeriod?.id ?? null,
    status: {
      year,
      month,
      next,
      /** ① その月の予算の確定日時 */
      confirmedAt: period?.budgetConfirmations[0]?.confirmedAt ?? null,
      /** ③ 翌月の予算の確定日時 */
      nextConfirmedAt: nextPeriod?.budgetConfirmations[0]?.confirmedAt ?? null,
      // 前月の予算が確定済みで実績が未確定なら、その月の予算はまだ確定できない
      prevActualsPending:
        (prevPeriod?.budgetConfirmations.length ?? 0) > 0 && !prevPeriod!.actualsConfirmation,
      /** ② その月の実績の入力状況と確定状況 */
      actuals: {
        confirmedAt: period?.actualsConfirmation?.confirmedAt ?? null,
        /** 実績が 1 件でも記録されているか（明細のそろい具合とは別） */
        recorded,
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
