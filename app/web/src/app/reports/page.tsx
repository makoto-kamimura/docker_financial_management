"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { downloadSvgAsPng } from "@/lib/export-client";

type Row = {
  period: string;
  budget: number;
  actual: number | null;
  forecast: number | null;
  variance: number | null;
  achievementRate: number | null;
};
type Report = {
  accountCode: string;
  year: number;
  method: string;
  rows: Row[];
  totals: { budget: number; actual: number; forecast: number; variance: number };
};

const yen = (v: number | null) => (v == null ? "—" : v.toLocaleString("ja-JP"));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function ReportsPage() {
  const [method, setMethod] = useState("holt_winters");
  const chartRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["budget-actual", method],
    queryFn: async (): Promise<Report> => {
      const res = await fetch(
        `/api/reports/budget-actual?accountCode=4000&year=2025&method=${method}`,
      );
      return res.json();
    },
  });

  const csvUrl = `/api/reports/budget-actual/export?accountCode=4000&year=2025&method=${method}`;

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>予実対比レポート（売上 / 2025）</h1>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          予測手法{" "}
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="linear_regression">線形回帰</option>
            <option value="moving_average">移動平均</option>
            <option value="growth_rate">成長率</option>
            <option value="holt">指数平滑(Holt)</option>
            <option value="holt_winters">季節性(Holt-Winters)</option>
          </select>
        </label>
        <a href={csvUrl}>
          <button type="button">CSV 出力</button>
        </a>
        <button
          type="button"
          onClick={() => downloadSvgAsPng(chartRef.current, "budget-actual.png")}
        >
          PNG 出力
        </button>
        <button type="button" onClick={() => window.print()}>
          PDF 出力（印刷）
        </button>
      </div>

      <div ref={chartRef}>
        {data && (
          <BudgetActualChart
            data={data.rows.map((r) => ({
              period: r.period,
              budget: r.budget,
              actual: r.actual,
              forecast: r.forecast,
            }))}
          />
        )}
      </div>

      {data && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.5rem" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>期間</th>
              <th style={th}>予算</th>
              <th style={th}>実績</th>
              <th style={th}>予測</th>
              <th style={th}>差異</th>
              <th style={th}>達成率</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.period}>
                <td style={td}>{r.period}</td>
                <td style={tdr}>{yen(r.budget)}</td>
                <td style={tdr}>{yen(r.actual)}</td>
                <td style={tdr}>{yen(r.forecast)}</td>
                <td style={{ ...tdr, color: (r.variance ?? 0) < 0 ? "crimson" : "green" }}>
                  {yen(r.variance)}
                </td>
                <td style={tdr}>{pct(r.achievementRate)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: "#f9fafb" }}>
              <td style={td}>合計</td>
              <td style={tdr}>{yen(data.totals.budget)}</td>
              <td style={tdr}>{yen(data.totals.actual)}</td>
              <td style={tdr}>{yen(data.totals.forecast)}</td>
              <td style={tdr}>{yen(data.totals.variance)}</td>
              <td style={tdr}>—</td>
            </tr>
          </tbody>
        </table>
      )}

      <p style={{ marginTop: "1rem" }}>
        <a href="/dashboard">← ダッシュボードへ</a>
      </p>
    </main>
  );
}

const th: React.CSSProperties = { border: "1px solid #e5e7eb", padding: "0.4rem", textAlign: "left" };
const td: React.CSSProperties = { border: "1px solid #e5e7eb", padding: "0.4rem" };
const tdr: React.CSSProperties = { ...td, textAlign: "right" };
