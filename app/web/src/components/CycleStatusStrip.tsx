"use client";

// ダッシュボードの「予算と実績の確定」の状況（KPI の下の 1 行）。
// KPI の対象月の ① 予算 → ② 実績 → ③ 翌月の予算 の確定状況を出し、各段から予算管理・実績管理の
// 確定タブへ移れるようにする。確定の操作そのものは、それぞれの画面で行う。

import { useQuery } from "@tanstack/react-query";
import { CycleSteps, type CycleStatus } from "@/components/CycleSteps";
import { DASHBOARD_HELP } from "@/lib/shared/help-texts";

export function CycleStatusStrip({ period }: { period: string | null }) {
  const [year, month] = (period ?? "").split("-").map(Number);
  const enabled = Number.isInteger(year) && Number.isInteger(month);
  const { data } = useQuery({
    queryKey: ["cycle-status", year, month],
    queryFn: async (): Promise<CycleStatus> =>
      (await (await fetch(`/api/cycle-status?year=${year}&month=${month}`)).json()).data,
    enabled,
    // 月の切り替え中も前の状況を出し続け、行のちらつきを防ぐ
    placeholderData: (prev) => prev,
  });
  if (!enabled || !data) return null;

  return (
    <section aria-labelledby="cycle-status-title" className="card mb-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="cycle-status-title" className="text-sm font-semibold text-slate-700">
          予算と実績の確定
        </h2>
        <CycleSteps status={data} links={{ budget: true, actuals: true }} />
      </div>
      <p className="text-[11px] text-slate-400 mt-1.5">{DASHBOARD_HELP.cycleStatus}</p>
    </section>
  );
}
