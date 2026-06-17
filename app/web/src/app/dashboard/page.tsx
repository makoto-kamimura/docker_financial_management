"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";

type ForecastResponse = {
  accountCode: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

// 実績の最終月の次の月から、予測値に連番の期間ラベルを振る
function buildTrend(res: ForecastResponse): TrendPoint[] {
  const points: TrendPoint[] = res.history.map((h) => ({ key: h.key, actual: h.total }));

  const last = res.history.at(-1)?.key; // "YYYY-MM"
  let [year, month] = last ? last.split("-").map(Number) : [new Date().getFullYear(), 0];

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

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["forecast", "4000"],
    queryFn: async (): Promise<ForecastResponse> => {
      const res = await fetch("/api/forecasts?accountCode=4000&months=6");
      if (!res.ok) throw new Error("failed to load forecast");
      return res.json();
    },
  });

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>ダッシュボード</h1>
      <p>売上高（科目コード 4000）の実績と将来予測の推移</p>

      {isLoading && <p>読み込み中…</p>}
      {error && <p style={{ color: "crimson" }}>データの取得に失敗しました。</p>}
      {data && <TrendChart data={buildTrend(data)} />}

      <p style={{ marginTop: "1.5rem" }}>
        <a href="/entry">実績データを入力する →</a>
      </p>
    </main>
  );
}
