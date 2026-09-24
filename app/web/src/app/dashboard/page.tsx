"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
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
import { downloadSvgAsPng } from "@/lib/export-client";
import { KpiCards } from "@/components/KpiCards";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { useViewMode, hasSwitchedViewMode } from "@/lib/use-view-mode";
import { computeStepChecklist } from "@/lib/step-checklist";
import { DEFAULT_FORECAST_METHOD, FORECAST_METHODS } from "@/lib/forecast-methods";

type TrendMonth = {
  key: string;
  isForecast: boolean;
  REVENUE: number;
  COGS: number;
  EXPENSE: number;
  PROFIT: number;
  OTHER: number;
  savings: number | null;
  savingsForecast: number | null;
};
type TrendResponse = {
  period: string;
  year: number | null;
  months: TrendMonth[];
  years: number[];
};

// 対象月を中心とした表示範囲（前 6 か月・後 6 か月＝予測 6 か月分）
const TREND_BACK = 6;
const TREND_FORWARD = 6;

const yen = (v: number | null) => (v == null ? "—" : v.toLocaleString("ja-JP"));
const man = (v: number) => `${Math.round(v / 10000).toLocaleString()}万`;
// "2026-07" → "2026年7月"
const periodLabel = (key: string) => {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
};
const monthLabel = (key: string) => `${Number(key.split("-")[1])}月`;

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

// F-10: ステップ進捗チェックリスト。全ステップ達成後は非表示にする（オンボーディング用途）。
function StepChecklistCard() {
  const { data } = useQuery({
    queryKey: ["onboarding-steps"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding/steps");
      const json = await res.json();
      return json.data as {
        hasIncomeBudget: boolean;
        hasExpenseBudget: boolean;
        hasBankAccount: boolean;
        hasPersonalAsset: boolean;
        hasLoan: boolean;
      };
    },
  });
  const [hasSwitchedMode, setHasSwitchedMode] = useState(false);

  useEffect(() => {
    setHasSwitchedMode(hasSwitchedViewMode());
    const handler = () => setHasSwitchedMode(hasSwitchedViewMode());
    window.addEventListener("viewmode-change", handler);
    return () => window.removeEventListener("viewmode-change", handler);
  }, []);

  if (!data) return null;
  const items = computeStepChecklist({ ...data, hasSwitchedMode });
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="card mb-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">
        ステップ進捗（{doneCount} / {items.length}）
      </h2>
      <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((i) => (
          <li
            key={i.step}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              i.done ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"
            }`}
          >
            <span aria-hidden="true">{i.done ? "✅" : "⬜"}</span>
            <span>{i.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ダッシュボードは KPI と構成比グラフに絞る（予実対比は「レポート」へ集約した）。
export default function DashboardPage() {
  const [method, setMethod] = useState(DEFAULT_FORECAST_METHOD);
  const [compYear, setCompYear] = useState<number | null>(null);
  const sysMode = useViewMode();
  const chartRef = useRef<HTMLDivElement>(null);

  // KPI カードで選んだ対象月。グラフはこの月を中心に前後 6 か月を描く。
  const [kpiPeriod, setKpiPeriod] = useState<string | null>(null);
  // 構成比グラフの表示範囲。既定は対象月を中心とした前後 6 か月
  const [compRange, setCompRange] = useState<"window" | "year">("window");

  const centerYear = kpiPeriod ? Number(kpiPeriod.slice(0, 4)) : new Date().getFullYear();
  const yearForComp = compYear ?? centerYear;

  // 対象月±6か月（window）と年度（year）で同じ API を使う。
  // どちらも実績が確定している月より後は予測値で埋まる。
  const { data: trend, isLoading } = useQuery({
    queryKey: ["monthly-trend", compRange, kpiPeriod, yearForComp, method],
    enabled: compRange === "year" || kpiPeriod !== null,
    queryFn: async (): Promise<TrendResponse> => {
      const url =
        compRange === "year"
          ? `/api/reports/monthly-trend?year=${yearForComp}&method=${method}`
          : `/api/reports/monthly-trend?period=${kpiPeriod}&back=${TREND_BACK}` +
            `&forward=${TREND_FORWARD}&method=${method}`;
      const res = await fetch(url);
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  const months = trend?.months ?? [];
  const hasForecast = months.some((m) => m.isForecast);

  // 円グラフ: 表示範囲の合計。実績が未入力の将来月は予測値を含める。
  const totals = Object.keys(CAT_COLORS)
    .map((cat) => ({
      name: cat,
      value: months.reduce((s, m) => s + Number(m[cat as keyof TrendMonth] ?? 0), 0),
    }))
    .filter((d) => d.value > 0);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">ダッシュボード</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {sysMode === "household" ? "収支 KPI・構成比" : "財務 KPI・構成比"}
        </p>
      </div>

      <StepChecklistCard />

      <div className="card mb-6">
        <KpiCards mode={sysMode} onPeriodChange={setKpiPeriod} />
      </div>

      {/* ── 構成比グラフ ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {(["window", "year"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setCompRange(r)}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                compRange === r
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {r === "window" ? `対象月±${TREND_BACK}か月` : "年度"}
            </button>
          ))}
        </div>

        {compRange === "year" ? (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">年度</label>
            <select
              value={yearForComp}
              onChange={(e) => setCompYear(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(trend?.years ?? [yearForComp]).map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          </div>
        ) : (
          trend && (
            <span className="text-xs text-slate-500">
              対象月 {periodLabel(trend.period)} を中心に前後 {TREND_BACK} か月
            </span>
          )
        )}

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">予測手法</label>
          {/* 各手法の違いを説明する（ホバー / フォーカスで表示） */}
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label="予測手法の説明"
              className="inline-flex text-slate-400 hover:text-slate-600 focus:text-slate-600 focus:outline-none"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-80 rounded-md bg-slate-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block">
              実績が未入力の月を、どの計算方法で見積もるかを選びます。
              <span className="mt-1.5 block space-y-1">
                {FORECAST_METHODS.map((m) => (
                  <span key={m.value} className="block">
                    <span className="font-semibold">{m.label}</span>：{m.help}
                  </span>
                ))}
              </span>
            </span>
          </span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {FORECAST_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => downloadSvgAsPng(chartRef.current, "composition.png")}
          className="btn-secondary text-xs px-3 py-1.5 ml-auto"
        >
          PNG 出力
        </button>
      </div>

      {isLoading && <LoadingSpinner />}

      {trend && (
        <div className="grid gap-6 lg:grid-cols-2 mb-6">
          <div className="card">
            <h2 className="section-title mb-1">カテゴリ構成比</h2>
            <p className="text-xs text-slate-400 mb-3">
              {hasForecast
                ? "実績が未入力の月は予測値を含めて集計しています。"
                : "表示範囲の実績を集計しています。"}
            </p>
            {totals.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                この期間に集計できるデータがありません。
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={totals}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) =>
                        `${CAT_LABEL[name] ?? name} ${(percent * 100).toFixed(1)}%`
                      }
                    >
                      {totals.map((entry) => (
                        <Cell key={entry.name} fill={CAT_COLORS[entry.name] ?? "#cbd5e1"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [man(v), CAT_LABEL[name] ?? name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 justify-center">
                  {totals.map((d) => (
                    <li key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ background: CAT_COLORS[d.name] ?? "#cbd5e1" }}
                      />
                      {CAT_LABEL[d.name] ?? d.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="section-title mb-1">月別カテゴリ内訳（万円）</h2>
            <p className="text-xs text-slate-400 mb-3">
              薄い色の月は予測値です（実績が未入力の月を予測で補完しています）。
            </p>
            <div ref={chartRef}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={months} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="key"
                    tickFormatter={compRange === "year" ? monthLabel : undefined}
                    tick={{ fontSize: 9 }}
                  />
                  <YAxis
                    tickFormatter={(v) => `${Math.round(v / 10000)}`}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [man(v), CAT_LABEL[name] ?? name]}
                    labelFormatter={(k: string) =>
                      `${periodLabel(k)}${months.find((m) => m.key === k)?.isForecast ? "（予測）" : ""}`
                    }
                  />
                  <Legend formatter={(v) => CAT_LABEL[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                  {Object.keys(CAT_COLORS).map((cat) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLORS[cat]}>
                      {months.map((m) => (
                        <Cell key={m.key} fillOpacity={m.isForecast ? 0.4 : 1} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {months.length > 0 && (
        <div className="card overflow-hidden p-0">
          <h2 className="section-title px-4 pt-4">
            月次収支サマリー（
            {compRange === "year" ? `${yearForComp}年度` : `対象月±${TREND_BACK}か月`}）
          </h2>
          <p className="text-xs text-slate-400 px-4 pb-2">
            支出が収入を上回った月は赤背景で表示しています。実績が未入力の月は予測値（「予測」表示）です。
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["月", "収入", "支出", "差引"].map((h) => (
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
              {months.map((m) => {
                const revenue = Number(m.REVENUE ?? 0);
                const expense = Number(m.COGS ?? 0) + Number(m.EXPENSE ?? 0);
                const net = revenue - expense;
                const isDeficit = expense > revenue;
                return (
                  <tr
                    key={m.key}
                    className={
                      isDeficit
                        ? "bg-red-50 hover:bg-red-100 transition-colors"
                        : "hover:bg-slate-50 transition-colors"
                    }
                  >
                    <td
                      className={`px-4 py-2.5 font-medium ${isDeficit ? "text-red-700" : "text-slate-700"}`}
                    >
                      {isDeficit && (
                        <span aria-hidden="true" className="mr-1">
                          ⚠
                        </span>
                      )}
                      {compRange === "year" ? monthLabel(m.key) : periodLabel(m.key)}
                      {m.isForecast && (
                        <span className="ml-1.5 text-[10px] font-normal text-orange-500 border border-orange-200 bg-orange-50 rounded px-1 py-0.5 align-middle">
                          予測
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{yen(revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{yen(expense)}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-medium ${net < 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {yen(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
