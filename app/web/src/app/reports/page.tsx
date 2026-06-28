"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { downloadSvgAsPng } from "@/lib/export-client";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";

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
type CompositionResponse = {
  year: number;
  monthly: Record<string, number | string>[];
  totals: { name: string; value: number }[];
  years: number[];
};

const yen = (v: number | null) => (v == null ? "—" : v.toLocaleString("ja-JP"));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const man = (v: number) => `${Math.round(v / 10000).toLocaleString()}万`;

const CAT_LABEL: Record<string, string> = {
  REVENUE: "収入",
  COGS: "変動費",
  EXPENSE: "固定費",
  PROFIT: "貯蓄/利益",
  OTHER: "税金等",
};
const CAT_COLORS: Record<string, string> = {
  REVENUE: "#6366f1",
  COGS: "#f97316",
  EXPENSE: "#f59e0b",
  PROFIT: "#10b981",
  OTHER: "#94a3b8",
};

function toAnnualRows(rows: Row[]): Row[] {
  const byYear = new Map<string, Row[]>();
  for (const r of rows) {
    const y = r.period.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }
  return Array.from(byYear.entries()).map(([year, ys]) => {
    const budget = ys.reduce((s, r) => s + r.budget, 0);
    const actualSum = ys.filter((r) => r.actual != null).reduce((s, r) => s + (r.actual ?? 0), 0);
    const actual = ys.some((r) => r.actual != null) ? actualSum : null;
    const forecastSum = ys
      .filter((r) => r.forecast != null)
      .reduce((s, r) => s + (r.forecast ?? 0), 0);
    const forecast = ys.some((r) => r.forecast != null) ? forecastSum : null;
    const variance = actual != null ? actual - budget : null;
    const achievementRate = actual != null && budget > 0 ? actual / budget : null;
    return { period: `${year}年`, budget, actual, forecast, variance, achievementRate };
  });
}

type AccountItem = { id: number; code: string; name: string; category: string };

export default function ReportsPage() {
  const [tab, setTab] = useState<"budget" | "composition">("budget");
  const [method, setMethod] = useState("holt_winters");
  const [viewMode, setViewMode] = useState<"monthly" | "annual">("monthly");
  const [compYear, setCompYear] = useState<number | null>(null);
  const [accountCode, setAccountCode] = useState("H1000");
  const [year, setYear] = useState(new Date().getFullYear());
  const chartRef = useRef<HTMLDivElement>(null);

  const { data: accountsData } = useQuery({
    queryKey: ["accounts-select"],
    queryFn: async (): Promise<AccountItem[]> => {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      return (json.data as AccountItem[]).filter((a) =>
        ["REVENUE", "COGS", "EXPENSE", "PROFIT"].includes(a.category),
      );
    },
  });

  const { data, isLoading: budgetLoading } = useQuery({
    queryKey: ["budget-actual", accountCode, year, method],
    queryFn: async (): Promise<Report> => {
      const res = await fetch(
        `/api/reports/budget-actual?accountCode=${accountCode}&year=${year}&method=${method}`,
      );
      return res.json();
    },
  });

  const { data: comp, isLoading: compLoading } = useQuery({
    queryKey: ["composition", compYear],
    queryFn: async (): Promise<CompositionResponse> => {
      const url = compYear
        ? `/api/reports/composition?year=${compYear}`
        : "/api/reports/composition";
      const res = await fetch(url);
      return res.json();
    },
  });

  const csvUrl = `/api/reports/budget-actual/export?accountCode=${accountCode}&year=${year}&method=${method}`;
  const displayRows = data ? (viewMode === "annual" ? toAnnualRows(data.rows) : data.rows) : [];

  const yearForComp = compYear ?? comp?.years.at(-1) ?? new Date().getFullYear();

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">レポート</h1>
        <p className="text-sm text-slate-500 mt-0.5">予実対比・カテゴリ構成比</p>
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["budget", "composition"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "budget" ? "予実対比" : "構成比グラフ"}
          </button>
        ))}
      </div>

      {/* ── 予実対比タブ ─────────────────────── */}
      {tab === "budget" && (
        <>
          <div className="card mb-6">
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">年度</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i).map(
                    (y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="flex items-center gap-1.5 flex-1">
                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">科目</label>
                <select
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px]"
                >
                  {(accountsData ?? []).map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                  予測手法
                </label>
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
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {(["monthly", "annual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                      viewMode === m
                        ? "bg-white text-slate-800 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {m === "monthly" ? "月次" : "年次"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <a href={csvUrl} className="btn-secondary text-xs px-3 py-1.5">
                  CSV 出力
                </a>
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
            {budgetLoading && <LoadingSpinner />}
            {viewMode === "monthly" && (
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
            )}
          </div>

          {data && displayRows.length > 0 && (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {["期間", "予算", "実績", "予測", "差異", "達成率"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayRows.map((r) => (
                    <tr key={r.period} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{r.period}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{yen(r.budget)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{yen(r.actual)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">
                        {yen(r.forecast)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums font-medium ${(r.variance ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}
                      >
                        {yen(r.variance)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {pct(r.achievementRate)}
                      </td>
                    </tr>
                  ))}
                  {viewMode === "monthly" && data && (
                    <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                      <td className="px-4 py-2.5 text-slate-700">合計</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {yen(data.totals.budget)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {yen(data.totals.actual)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">
                        {yen(data.totals.forecast)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${data.totals.variance < 0 ? "text-red-600" : "text-green-600"}`}
                      >
                        {yen(data.totals.variance)}
                      </td>
                      <td className="px-4 py-2.5 text-right">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── 構成比タブ ────────────────────────── */}
      {tab === "composition" && (
        <>
          <div className="flex items-center gap-2 mb-6">
            <label className="text-xs font-medium text-slate-600">年度</label>
            <select
              value={yearForComp}
              onChange={(e) => setCompYear(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(comp?.years ?? []).map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          </div>

          {compLoading && <LoadingSpinner />}

          {comp && (
            <div className="grid gap-6 lg:grid-cols-2 mb-6">
              {/* 円グラフ：年間カテゴリ構成比 */}
              <div className="card">
                <h2 className="section-title mb-4">年間カテゴリ構成比</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={comp.totals}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) =>
                        `${CAT_LABEL[name] ?? name} ${(percent * 100).toFixed(1)}%`
                      }
                    >
                      {comp.totals.map((entry) => (
                        <Cell key={entry.name} fill={CAT_COLORS[entry.name] ?? "#cbd5e1"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [man(v), CAT_LABEL[name] ?? name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* 凡例 */}
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 justify-center">
                  {comp.totals.map((d) => (
                    <li key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ background: CAT_COLORS[d.name] ?? "#cbd5e1" }}
                      />
                      {CAT_LABEL[d.name] ?? d.name}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 積み上げ棒グラフ：月別カテゴリ内訳 */}
              <div className="card">
                <h2 className="section-title mb-4">月別カテゴリ内訳（万円）</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={comp.monthly} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis
                      tickFormatter={(v) => `${Math.round(v / 10000)}`}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) => [man(v), CAT_LABEL[name] ?? name]}
                    />
                    <Legend formatter={(v) => CAT_LABEL[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                    {Object.keys(CAT_COLORS).map((cat) => (
                      <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLORS[cat]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
