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

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// 最新月の主要 KPI をカード表示する
export function KpiCards() {
  const { data } = useQuery({
    queryKey: ["kpi"],
    queryFn: async (): Promise<{ kpi: Kpi | null }> => {
      const res = await fetch("/api/kpi");
      return res.json();
    },
  });

  const kpi = data?.kpi;
  if (!kpi) return <p>KPI データがありません。</p>;

  return (
    <div>
      <p style={{ color: "#6b7280", fontSize: 13 }}>対象月: {kpi.period}</p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Card label="売上高" value={yen(kpi.revenue)} />
        <Card label="売上総利益" value={yen(kpi.grossProfit)} />
        <Card label="売上総利益率" value={pct(kpi.grossMargin)} />
        <Card label="営業利益" value={yen(kpi.operatingProfit)} />
        <Card label="営業利益率" value={pct(kpi.operatingMargin)} />
        <Card label="前月比 (MoM)" value={pct(kpi.mom)} />
        <Card label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
        <Card label="当年累計 (YTD)" value={yen(kpi.ytd)} />
      </div>
    </div>
  );
}
