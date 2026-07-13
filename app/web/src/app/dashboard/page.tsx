"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { BalanceChart, type BalancePoint } from "@/components/BalanceChart";
import { downloadSvgAsPng } from "@/lib/export-client";
import { KpiCards } from "@/components/KpiCards";
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
type AccountItem = { id: number; code: string; name: string; category: string };
type BankAccount = { id: number; name: string; bankName: string };
type SimResult = {
  accounts: { id: number; name: string }[];
  timeline: BalancePoint[];
  shortfalls: { date: string; accountId: number; accountName: string; balance: number }[];
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

function DashboardContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "budget") as
    | "budget"
    | "composition"
    | "simulation";
  const [tab, setTab] = useState<"budget" | "composition" | "simulation">(initialTab);
  const [method, setMethod] = useState("moving_average");
  const [viewMode, setViewMode] = useState<"monthly" | "annual">("monthly");
  const [compYear, setCompYear] = useState<number | null>(null);
  const [accountCode, setAccountCode] = useState("H1000");
  const [year, setYear] = useState(new Date().getFullYear());
  const [sysMode, setSysMode] = useState("sole");
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved && ["household", "sole", "corporate"].includes(saved)) setSysMode(saved);
    const handler = () => {
      const m = localStorage.getItem("viewMode");
      if (m && ["household", "sole", "corporate"].includes(m)) setSysMode(m);
    };
    window.addEventListener("viewmode-change", handler);
    return () => window.removeEventListener("viewmode-change", handler);
  }, []);

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
    queryFn: async (): Promise<Report | null> => {
      const res = await fetch(
        `/api/reports/budget-actual?accountCode=${accountCode}&year=${year}&method=${method}`,
      );
      // 科目未登録のテナント等ではエラーレスポンス（rows なし）が返るため null に落とす
      if (!res.ok) return null;
      const json = (await res.json()) as Report;
      return json.rows ? json : null;
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

  // ── 残高シミュレーション ───────────────────────────────────────────
  const [openings, setOpenings] = useState<Record<number, number>>({});
  const [months, setMonths] = useState(3);
  const [autoRan, setAutoRan] = useState(false);

  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });

  const sim = useMutation({
    mutationFn: async (): Promise<SimResult> => {
      const res = await fetch("/api/transfers/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openings: Object.fromEntries(Object.entries(openings).map(([k, v]) => [k, Number(v)])),
          months,
          startYear: now.getFullYear(),
          startMonth: now.getMonth() + 1,
        }),
      });
      if (!res.ok) throw new Error("simulation failed");
      return res.json();
    },
  });

  useEffect(() => {
    if (!bankAccounts || bankAccounts.length === 0) return;
    setOpenings((prev) =>
      Object.keys(prev).length > 0 ? prev : Object.fromEntries(bankAccounts.map((a) => [a.id, 0])),
    );
  }, [bankAccounts]);

  useEffect(() => {
    if (tab !== "simulation" || autoRan || !bankAccounts || bankAccounts.length === 0) return;
    setAutoRan(true);
    sim.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, bankAccounts]);

  // ── 共通計算 ──────────────────────────────────────────────────────
  const csvUrl = `/api/reports/budget-actual/export?accountCode=${accountCode}&year=${year}&method=${method}`;
  const displayRows = data ? (viewMode === "annual" ? toAnnualRows(data.rows) : data.rows) : [];
  const now = new Date();
  const fiscalYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const yearForComp = compYear ?? fiscalYear;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">ダッシュボード</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {sysMode === "household" ? "収支 KPI・予実管理" : "財務 KPI・予実管理"}
        </p>
      </div>

      <div className="card mb-6">
        <KpiCards mode={sysMode} />
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(
          [
            ["budget", "予実対比"],
            ["composition", "構成比グラフ"],
            ["simulation", "残高シミュレーション"],
          ] as ["budget" | "composition" | "simulation", string][]
        ).map(([t, label]) => (
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
            {label}
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

      {/* ── 残高シミュレーションタブ ─────────────── */}
      {tab === "simulation" && (
        <>
          <div className="card mb-4">
            <h2 className="section-title mb-3">条件設定</h2>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bankAccounts?.map((a) => (
                  <div key={a.id}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {a.name} <span className="text-slate-400">期首残高</span>
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      value={openings[a.id] ?? 0}
                      onChange={(e) =>
                        setOpenings((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">期間</label>
                  <select
                    className="input-field w-28"
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                  >
                    {[3, 6, 12].map((m) => (
                      <option key={m} value={m}>
                        {m}か月
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary px-5 py-2"
                  onClick={() => sim.mutate()}
                  disabled={sim.isPending}
                >
                  {sim.isPending ? "計算中…" : "シミュレーション実行"}
                </button>
              </div>
            </div>
          </div>

          {sim.isPending && <div className="text-center text-sm text-slate-400 py-8">計算中…</div>}
          {sim.data && (
            <>
              {(sim.data.shortfalls?.length ?? 0) > 0 ? (
                <div className="card mb-4 border border-red-200 bg-red-50">
                  <h2 className="section-title text-red-700 mb-2">⚠️ 残高不足の警告</h2>
                  <ul className="text-sm text-red-700 space-y-1">
                    {[
                      ...new Map(
                        sim.data.shortfalls.map((s) => [`${s.date}-${s.accountId}`, s]),
                      ).values(),
                    ]
                      .slice(0, 10)
                      .map((s, i) => (
                        <li key={i}>
                          {s.date}：<strong>{s.accountName}</strong> が{" "}
                          {s.balance.toLocaleString("ja-JP", {
                            style: "currency",
                            currency: "JPY",
                          })}
                          （マイナス）
                        </li>
                      ))}
                  </ul>
                </div>
              ) : (
                <div className="card mb-4 border border-green-200 bg-green-50">
                  <p className="text-sm text-green-700">
                    ✅ {months}か月間、残高不足は発生しません。
                  </p>
                </div>
              )}
              <div className="card">
                <h2 className="section-title mb-3">残高推移（{months}か月）</h2>
                <BalanceChart timeline={sim.data.timeline} accounts={sim.data.accounts} />
              </div>
            </>
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

          {comp && comp.monthly.length > 0 && (
            <div className="card overflow-hidden p-0">
              <h2 className="section-title px-4 pt-4">月次収支サマリー（実績）</h2>
              <p className="text-xs text-slate-400 px-4 pb-2">
                支出が収入を上回った月は赤背景で表示しています。
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
                  {comp.monthly.map((row) => {
                    const revenue = Number(row.REVENUE ?? 0);
                    const expense = Number(row.COGS ?? 0) + Number(row.EXPENSE ?? 0);
                    const net = revenue - expense;
                    const isDeficit = expense > revenue;
                    return (
                      <tr
                        key={String(row.month)}
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
                          {row.month}
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
        </>
      )}
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
