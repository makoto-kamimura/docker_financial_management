"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { CycleStatusStrip } from "@/components/CycleStatusStrip";
import { KpiCards } from "@/components/KpiCards";
import { PageHeader, SegmentedControl } from "@/components/ui";
import { useFiscalYear } from "@/lib/use-fiscal-year";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { useViewMode, hasSwitchedViewMode } from "@/lib/use-view-mode";
import { computeStepChecklist } from "@/lib/step-checklist";
import { DEFAULT_FORECAST_METHOD, FORECAST_METHODS } from "@/lib/forecast-methods";
import { DASHBOARD_HELP, textFor } from "@/lib/help-texts";

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
      <h2 className="text-sm font-semibold text-slate-700 mb-1">
        ステップ進捗（{doneCount} / {items.length}）
      </h2>
      <SectionLead>{DASHBOARD_HELP.steps}</SectionLead>
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

// ダッシュボードは KPI・予算と実績の確定の状況・予算と実績のグラフ・構成比グラフを置く。
// 確定の操作は予算管理（予算の確定）と実績管理（実績の確定）で行い、ここには状況とリンクだけ置く。
export default function DashboardPage() {
  const [method, setMethod] = useState(DEFAULT_FORECAST_METHOD);
  const sysMode = useViewMode();
  const chartRef = useRef<HTMLDivElement>(null);

  // KPI カードで選んだ対象月。グラフはこの月を中心に前後 6 か月を描く。
  const [kpiPeriod, setKpiPeriod] = useState<string | null>(null);
  // 構成比グラフの表示範囲。既定は対象月を中心とした前後 6 か月
  const [compRange, setCompRange] = useState<"window" | "year">("window");

  // 構成比グラフの「年度」は、左のメニューの対象年度
  const yearForComp = useFiscalYear();

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

  const selectedMethod = FORECAST_METHODS.find((m) => m.value === method);
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
      <PageHeader title="ダッシュボード" lead={textFor(DASHBOARD_HELP.page, sysMode)} showYear />

      <StepChecklistCard />

      <div className="card mb-6">
        <SectionLead>{textFor(DASHBOARD_HELP.kpi, sysMode)}</SectionLead>
        <KpiCards mode={sysMode} onPeriodChange={setKpiPeriod} />
      </div>

      {/* ── 予算と実績の確定の状況（前月。操作は予算管理・実績管理で行う）──── */}
      <CycleStatusStrip />

      {/* ── 予算と実績（KPI の対象月の差をひと目で）──── */}
      <BudgetActualChart mode={sysMode} period={kpiPeriod} />

      {/* ── 構成比グラフ ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <SegmentedControl
          label="グラフの表示範囲"
          options={[
            ["window", `対象月±${TREND_BACK}か月`],
            ["year", "年度"],
          ]}
          value={compRange}
          onChange={setCompRange}
        />

        {compRange === "year" ? (
          <span className="text-xs text-slate-500">{yearForComp}年（1〜12 月）</span>
        ) : (
          trend && (
            <span className="text-xs text-slate-500">
              対象月 {periodLabel(trend.period)} を中心に前後 {TREND_BACK} か月
            </span>
          )
        )}

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">予測手法</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="select-sm">
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
          className="btn-secondary btn-sm ml-auto"
        >
          PNG 出力
        </button>
      </div>

      {/* 予測手法の説明は、選んでいる手法の分だけ常に出す（手法を変えると切り替わる） */}
      <SectionLead className="-mt-4 mb-6">
        {DASHBOARD_HELP.forecast}
        {selectedMethod && (
          <>
            {" "}
            <span className="font-semibold text-slate-600">{selectedMethod.label}</span>：
            {selectedMethod.help}
          </>
        )}
      </SectionLead>

      {isLoading && <LoadingSpinner />}

      {trend && (
        <div className="grid gap-6 lg:grid-cols-2 mb-6">
          <div className="card">
            <h2 className="section-title mb-1">カテゴリ構成比</h2>
            <SectionLead>
              {textFor(DASHBOARD_HELP.composition, sysMode)}
              {hasForecast
                ? "実績が未入力の月は予測値を含めて集計しています。"
                : "表示範囲の実績を集計しています。"}
            </SectionLead>
            {totals.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">{DASHBOARD_HELP.empty}</p>
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
            <SectionLead>
              {textFor(DASHBOARD_HELP.monthly, sysMode)}
              薄い色の月は予測値です（実績が未入力の月を予測で補完しています）。
            </SectionLead>
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
    </AppShell>
  );
}
