"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { downloadSvgAsPng } from "@/lib/export-client";
import { AppShell } from "@/components/AppShell";

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
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">予実対比レポート</h1>
        <p className="text-sm text-slate-500 mt-0.5">売上 / 2025年度</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-1.5 flex-1">
            <label className="text-xs font-medium text-slate-600 whitespace-nowrap">予測手法</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="linear_regression">線形回帰</option>
              <option value="moving_average">移動平均</option>
              <option value="growth_rate">成長率</option>
              <option value="holt">指数平滑(Holt)</option>
              <option value="holt_winters">季節性(Holt-Winters)</option>
            </select>
          </div>
          <div className="flex gap-2">
            <a href={csvUrl} className="btn-secondary text-xs px-3 py-1.5">CSV 出力</a>
            <button
              type="button"
              onClick={() => downloadSvgAsPng(chartRef.current, "budget-actual.png")}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              PNG 出力
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              PDF 出力
            </button>
          </div>
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
      </div>

      {data && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["期間", "予算", "実績", "予測", "差異", "達成率"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r) => (
                <tr key={r.period} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{r.period}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{yen(r.budget)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{yen(r.actual)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">{yen(r.forecast)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(r.variance ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                    {yen(r.variance)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.achievementRate)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                <td className="px-4 py-2.5 text-slate-700">合計</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{yen(data.totals.budget)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{yen(data.totals.actual)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">{yen(data.totals.forecast)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${data.totals.variance < 0 ? "text-red-600" : "text-green-600"}`}>
                  {yen(data.totals.variance)}
                </td>
                <td className="px-4 py-2.5 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
