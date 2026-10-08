"use client";

// 月ごとの流れ「① 予算の確定 → ② 実績の確定 → ③ 翌月の予算の確定」の状況表示。
// 予算管理の「予実差確認」「予算の確定」、実績管理の「実績の確定」、ダッシュボードの状況の 1 行で共用する。
// ①③ は予算管理、② は実績管理で操作するので、links を指定すると各段をその画面へのリンクにする
// （予算の確定タブは「予算の月」で開くので、① はその月、③ は翌月の予算の確定へ）。

import Link from "next/link";
import { CheckCircle2, Clock, Lock } from "lucide-react";

export type ActualsSource = {
  kind: "bank" | "card";
  id: number;
  name: string;
  typeLabel: string;
  /** 明細の最終日（YYYY-MM-DD）。明細が無ければ null（判定に含めない） */
  lastDate: string | null;
};

/** 実績を確定したときに記録した、確定時点の明細の状況（lib/actuals-coverage.ts の CoverageSnapshot） */
export type CoverageSnapshot = {
  monthEnd: string;
  coveredThrough: string | null;
  sources: (ActualsSource & { noChange: boolean })[];
};

/** GET /api/cycle-status（lib/cycle-status.ts）の data。予実対比のレスポンスにも同じ項目が入る */
export type CycleStatus = {
  year: number;
  month: number;
  next: { year: number; month: number };
  confirmedAt: string | null;
  nextConfirmedAt: string | null;
  prevActualsPending: boolean;
  actuals: {
    confirmedAt: string | null;
    entered: boolean;
    coveredThrough: string | null;
    monthEnd: string;
    sources: ActualsSource[];
    lagging: { kind: ActualsSource["kind"]; id: number }[];
    /** 科目が付いていない明細の件数 */
    unassigned: number;
    /** 確定時点の記録。確定していない月と、記録を始める前に確定した月は null */
    confirmedCoverage: CoverageSnapshot | null;
  };
};

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** 予算管理の「予実差確認」タブ（比べる月付き） */
export const budgetVarianceHref = (year: number, month: number) =>
  `/budget?tab=variance&month=${ym(year, month)}`;
/** 予算管理の「予算の確定」タブ（予算の月付き） */
export const budgetConfirmHref = (year: number, month: number) =>
  `/budget?tab=confirm&month=${ym(year, month)}`;
/** 実績管理の「実績の確定」タブ（対象月付き） */
export const actualsConfirmHref = (year: number, month: number) =>
  `/entry?tab=confirm&month=${ym(year, month)}`;

export const formatYmd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

export function StatusBadge({ label, confirmedAt }: { label: string; confirmedAt: string | null }) {
  return confirmedAt ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700"
      title={`確定日時 ${new Date(confirmedAt).toLocaleString("ja-JP")}`}
    >
      <Lock className="w-3 h-3" aria-hidden="true" />
      {label}：確定済み
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-slate-600">
      {label}：未確定
    </span>
  );
}

export function ActualsBadge({
  label,
  confirmedAt,
  entered,
}: {
  label: string;
  confirmedAt: string | null;
  entered: boolean;
}) {
  if (confirmedAt) return <StatusBadge label={label} confirmedAt={confirmedAt} />;
  return entered ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-sky-700">
      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
      {label}：入力済み
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700">
      <Clock className="w-3 h-3" aria-hidden="true" />
      {label}：入力待ち
    </span>
  );
}

function Step({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href as never} className="rounded-full hover:ring-2 hover:ring-indigo-200">
      {children}
    </Link>
  );
}

export function CycleSteps({
  status,
  links = {},
}: {
  status: CycleStatus;
  /** budget: ①③ を予算管理へのリンクにする / actuals: ② を実績管理へのリンクにする */
  links?: { budget?: boolean; actuals?: boolean };
}) {
  const { year, month, next } = status;
  const arrow = (
    <span className="text-slate-300" aria-hidden="true">
      →
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Step href={links.budget ? budgetConfirmHref(year, month) : undefined}>
        <StatusBadge label={`① ${month}月の予算`} confirmedAt={status.confirmedAt} />
      </Step>
      {arrow}
      <Step href={links.actuals ? actualsConfirmHref(year, month) : undefined}>
        <ActualsBadge
          label={`② ${month}月の実績`}
          confirmedAt={status.actuals.confirmedAt}
          entered={status.actuals.entered}
        />
      </Step>
      {arrow}
      <Step href={links.budget ? budgetConfirmHref(next.year, next.month) : undefined}>
        <StatusBadge label={`③ ${next.month}月の予算`} confirmedAt={status.nextConfirmedAt} />
      </Step>
    </div>
  );
}
