import { nextYearMonth } from "./budget-cycle";

// 予算と実績の確定まわりの画面（予実差確認・予算の確定・実績の確定）で、開いたときの対象月を決める。
// 年は左のメニューの対象年度で選ぶので、画面では月だけを選ぶ。
// 既定は「最後に実績を確定した月」L を起点にする:
//   予実差確認は L（確定した実績と予算を比べる）、予算の確定と実績の確定は L の翌月（次にやる月）。
//   実績をまだ一度も確定していなければ前月（実績の月が締まるのは翌月のため）。

export type CycleMonthKind = "variance" | "budget" | "actuals";

export const cycleKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

/** 前月の "YYYY-MM" */
export function previousMonthKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m === 1 ? cycleKey(y - 1, 12) : cycleKey(y, m - 1);
}

/** 画面ごとの既定の対象月（"YYYY-MM"） */
export function defaultCycleKey(
  lastActualsConfirmed: string | null,
  kind: CycleMonthKind,
  now: Date = new Date(),
): string {
  if (!lastActualsConfirmed) return previousMonthKey(now);
  if (kind === "variance") return lastActualsConfirmed;
  const [y, m] = lastActualsConfirmed.split("-").map(Number);
  const next = nextYearMonth(y, m);
  return cycleKey(next.year, next.month);
}

/**
 * 既定の月を、左のメニューの年で選べる月（1〜12）に直す。
 * 年が同じならその月。メニューの年の方が前なら 12 月、後なら 1 月（その年でいちばん近い月）。
 */
export function monthInYear(key: string, fiscalYear: number): number {
  const [y, m] = key.split("-").map(Number);
  if (y === fiscalYear) return m;
  return fiscalYear < y ? 12 : 1;
}
