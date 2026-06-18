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

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-lg font-bold text-slate-900 tabular-nums">{value}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </div>
  );
}

export function KpiCards() {
  const { data } = useQuery({
    queryKey: ["kpi"],
    queryFn: async (): Promise<{ kpi: Kpi | null }> => {
      const res = await fetch("/api/kpi");
      return res.json();
    },
  });

  const kpi = data?.kpi;
  if (!kpi)
    return (
      <p className="text-sm text-slate-400 py-4">KPI データがありません。</p>
    );

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">対象月: {kpi.period}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="売上高" value={yen(kpi.revenue)} />
        <KpiCard label="売上総利益" value={yen(kpi.grossProfit)} sub={`粗利率 ${pct(kpi.grossMargin)}`} />
        <KpiCard label="営業利益" value={yen(kpi.operatingProfit)} sub={`営業利益率 ${pct(kpi.operatingMargin)}`} />
        <KpiCard label="当年累計 (YTD)" value={yen(kpi.ytd)} />
        <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} />
        <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
      </div>
    </div>
  );
}
