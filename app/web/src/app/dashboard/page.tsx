"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { KpiCards } from "@/components/KpiCards";
import { AppShell } from "@/components/AppShell";

type ForecastResponse = {
  accountCode: string;
  method: string;
  scenario: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

function buildTrend(res: ForecastResponse): TrendPoint[] {
  const points: TrendPoint[] = res.history.map((h) => ({ key: h.key, actual: h.total }));
  const last = res.history.at(-1)?.key;
  let [year, month] = last ? last.split("-").map(Number) : [new Date().getFullYear(), 0];
  if (points.length) points[points.length - 1].forecast = points[points.length - 1].actual;
  for (const value of res.forecast) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    points.push({ key: `${year}-${String(month).padStart(2, "0")}`, forecast: value });
  }
  return points;
}

const METHOD_LABELS: Record<string, string> = {
  linear_regression: "線形回帰",
  moving_average: "移動平均",
  growth_rate: "成長率",
  holt: "指数平滑(Holt)",
  holt_winters: "季節性(Holt-Winters)",
};
const SCENARIO_LABELS: Record<string, string> = {
  base: "標準",
  optimistic: "楽観",
  pessimistic: "悲観",
};

export default function DashboardPage() {
  const [method, setMethod] = useState("linear_regression");
  const [scenario, setScenario] = useState("base");
  const [months, setMonths] = useState(6);

  const { data, isLoading, error } = useQuery({
    queryKey: ["forecast", "4000", method, scenario, months],
    queryFn: async (): Promise<ForecastResponse> => {
      const res = await fetch(
        `/api/forecasts?accountCode=4000&months=${months}&method=${method}&scenario=${scenario}`,
      );
      if (!res.ok) throw new Error("failed to load forecast");
      return res.json();
    },
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">ダッシュボード</h1>
        <p className="text-sm text-slate-500 mt-0.5">財務 KPI・売上推移・予測</p>
      </div>

      <div className="card mb-6">
        <KpiCards />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <h2 className="section-title mb-0 flex-1">売上推移（実績＋予測）</h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-600">予測手法</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(METHOD_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-600">シナリオ</label>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(SCENARIO_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-600">予測期間</label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {[3, 6, 12].map((m) => (
                  <option key={m} value={m}>{m}か月</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center h-60 text-sm text-slate-400">
            読み込み中…
          </div>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            データの取得に失敗しました。
          </p>
        )}
        {data && <TrendChart data={buildTrend(data)} />}
      </div>
    </AppShell>
  );
}
