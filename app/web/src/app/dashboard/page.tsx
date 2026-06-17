"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { KpiCards } from "@/components/KpiCards";

type ForecastResponse = {
  accountCode: string;
  method: string;
  scenario: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

// 実績の最終月の次の月から、予測値に連番の期間ラベルを振る
function buildTrend(res: ForecastResponse): TrendPoint[] {
  const points: TrendPoint[] = res.history.map((h) => ({ key: h.key, actual: h.total }));

  const last = res.history.at(-1)?.key; // "YYYY-MM"
  let [year, month] = last ? last.split("-").map(Number) : [new Date().getFullYear(), 0];

  // 実績の最終点と予測線をつなぐため、最終実績点に forecast も持たせる
  if (points.length) points[points.length - 1].forecast = points[points.length - 1].actual;

  for (const value of res.forecast) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
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

  const selectStyle = { padding: "0.25rem 0.5rem" };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>ダッシュボード</h1>

      <KpiCards />

      <h2 style={{ marginTop: "2rem" }}>売上推移（実績＋予測）</h2>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          予測手法{" "}
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={selectStyle}>
            {Object.entries(METHOD_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          シナリオ{" "}
          <select value={scenario} onChange={(e) => setScenario(e.target.value)} style={selectStyle}>
            {Object.entries(SCENARIO_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          予測期間{" "}
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={selectStyle}
          >
            {[3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m}か月
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p>読み込み中…</p>}
      {error && <p style={{ color: "crimson" }}>データの取得に失敗しました。</p>}
      {data && <TrendChart data={buildTrend(data)} />}

      <p style={{ marginTop: "1.5rem" }}>
        <a href="/entry">実績入力</a> ｜ <a href="/masters">マスタ管理</a> ｜{" "}
        <a href="/reports">予実対比レポート</a>
      </p>
    </main>
  );
}
