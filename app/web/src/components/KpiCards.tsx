"use client";

import { useQuery } from "@tanstack/react-query";

type Kpi = {
  period: string;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  operatingProfit: number;
  operatingMargin: number;
  mom: number | null;
  yoy: number | null;
  ytd: number;
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

function KpiCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  /** true のとき赤色強調 + 警告アイコンを表示する（当月赤字警告） */
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-4 flex flex-col gap-1 ${
        warn ? "bg-red-50 border-red-300" : "bg-white border-slate-200"
      }`}
    >
      <span
        className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1 ${
          warn ? "text-red-600" : "text-slate-500"
        }`}
      >
        {warn && <span aria-hidden="true">⚠</span>}
        {label}
      </span>
      <span
        className={`text-lg font-bold tabular-nums ${warn ? "text-red-700" : "text-slate-900"}`}
      >
        {value}
      </span>
      {sub && <span className={`text-xs ${warn ? "text-red-500" : "text-slate-400"}`}>{sub}</span>}
    </div>
  );
}

export function KpiCards({ mode = "sole" }: { mode?: string }) {
  const { data } = useQuery({
    queryKey: ["kpi"],
    queryFn: async (): Promise<{ kpi: Kpi | null }> => {
      const res = await fetch("/api/kpi");
      return res.json();
    },
  });

  const kpi = data?.kpi;
  if (!kpi) return <p className="text-sm text-slate-400 py-4">KPI データがありません。</p>;

  if (mode === "household") {
    const expenses = kpi.revenue - kpi.operatingProfit;
    const isDeficit = kpi.operatingProfit < 0;
    return (
      <div>
        <p className="text-xs text-slate-400 mb-3">対象月: {kpi.period}</p>
        {isDeficit && (
          <p className="text-sm text-red-600 font-medium mb-3 flex items-center gap-1.5">
            <span aria-hidden="true">⚠</span>
            今月は支出が収入を上回っています
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="収入" value={yen(kpi.revenue)} />
          <KpiCard label="支出" value={yen(expenses)} />
          <KpiCard
            label="貯蓄額"
            value={yen(kpi.operatingProfit)}
            sub={`貯蓄率 ${pct(kpi.operatingMargin)}`}
            warn={isDeficit}
          />
          <KpiCard label="当年累計 (YTD)" value={yen(kpi.ytd)} />
          <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} />
          <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">対象月: {kpi.period}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="売上高" value={yen(kpi.revenue)} />
        <KpiCard
          label="売上総利益"
          value={yen(kpi.grossProfit)}
          sub={`粗利率 ${pct(kpi.grossMargin)}`}
        />
        <KpiCard
          label="営業利益"
          value={yen(kpi.operatingProfit)}
          sub={`営業利益率 ${pct(kpi.operatingMargin)}`}
        />
        <KpiCard label="当年累計 (YTD)" value={yen(kpi.ytd)} />
        <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} />
        <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
      </div>
    </div>
  );
}
