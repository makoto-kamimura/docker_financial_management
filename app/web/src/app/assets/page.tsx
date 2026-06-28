"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";

type AccountBalance = {
  id: number;
  code: string;
  name: string;
  category: "ASSET" | "LIABILITY";
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
  balances: { fiscalYear: number; month: number; amount: number }[];
};

type AssetsResponse = {
  years: number[];
  accounts: AccountBalance[];
};

const yen = (v: number) =>
  v >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

function latestBalance(balances: AccountBalance["balances"], year: number): number {
  const ys = balances.filter((b) => b.fiscalYear === year);
  if (!ys.length) return 0;
  return ys.reduce((best, b) => (b.month > best.month ? b : best)).amount;
}

function leafOf(accounts: AccountBalance[], cat: "ASSET" | "LIABILITY"): AccountBalance[] {
  return accounts.filter(
    (a): a is AccountBalance => a.category === cat && !accounts.some((c) => c.parentId === a.id),
  );
}

function buildTrendData(accounts: AccountBalance[], years: number[]) {
  const assetLeaves = leafOf(accounts, "ASSET");
  const liabLeaves = leafOf(accounts, "LIABILITY");
  return years.map((year) => {
    const totalAsset = assetLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    const totalLiab = liabLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    return {
      year: String(year),
      資産合計: Math.round(totalAsset / 1_0000),
      負債合計: Math.round(totalLiab / 1_0000),
      純資産: Math.round((totalAsset - totalLiab) / 1_0000),
    };
  });
}

async function fetchAssets(): Promise<AssetsResponse> {
  const res = await fetch("/api/assets");
  if (!res.ok) throw new Error("failed to load assets");
  return res.json() as Promise<AssetsResponse>;
}

export default function AssetsPage() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpandedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { data, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: fetchAssets,
  });

  const year = selectedYear ?? data?.years.at(-1) ?? new Date().getFullYear();
  const accounts = data?.accounts ?? [];
  const years = data?.years ?? [];

  const topAssets = accounts.filter((a) => a.category === "ASSET" && a.parentId === null);
  const topLiabs = accounts.filter((a) => a.category === "LIABILITY" && a.parentId === null);

  const totalAsset = leafOf(accounts, "ASSET").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const totalLiab = leafOf(accounts, "LIABILITY").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const netWorth = totalAsset - totalLiab;

  const trendData = buildTrendData(accounts, years);

  const childrenOf = (parentId: number): AccountBalance[] =>
    accounts.filter((a) => a.parentId === parentId);

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-title">資産管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">バランスシート・純資産推移</p>
        </div>
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">表示年</label>
            <select
              value={year}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading && <LoadingSpinner />}

      {!isLoading && accounts.length === 0 && (
        <EmptyState
          title="資産データがありません"
          description="ASSET / LIABILITY カテゴリの勘定科目を登録し assets_lifeplan.csv をインポートしてください。"
        />
      )}

      {accounts.length > 0 && (
        <>
          {/* KPI カード */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">資産合計</p>
              <p className="text-2xl font-bold text-emerald-600">{yen(totalAsset)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">負債合計</p>
              <p className="text-2xl font-bold text-rose-600">{yen(totalLiab)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">純資産</p>
              <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-indigo-600" : "text-red-600"}`}>
                {yen(netWorth)}
              </p>
            </div>
          </div>

          {/* 純資産推移グラフ */}
          {trendData.length > 0 && (
            <div className="card mb-6">
              <h2 className="section-title mb-4">純資産推移（万円）</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()}万円`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="資産合計" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="負債合計" stroke="#f43f5e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="純資産" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* バランスシート詳細テーブル */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* 資産の部 */}
            <div className="card">
              <h2 className="section-title">資産の部</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="text-left py-1.5 font-medium">勘定科目</th>
                    <th className="text-right py-1.5 font-medium">{year}年末残高</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {topAssets.map((a) => {
                    const children = childrenOf(a.id);
                    const subtotal = children.reduce((s, c) => s + latestBalance(c.balances, year), 0);
                    const open = expandedIds.has(a.id);
                    return (
                      <>
                        <tr
                          key={a.id}
                          className="font-medium bg-slate-50/60 cursor-pointer select-none hover:bg-slate-100/80"
                          onClick={() => toggle(a.id)}
                        >
                          <td className="py-2 text-slate-800">
                            <span className="inline-flex items-center gap-1">
                              <svg className="w-3 h-3 text-slate-400 shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                              <span className="text-xs font-mono text-slate-400 mr-1">{a.code}</span>
                              {a.name}
                            </span>
                          </td>
                          <td className="py-2 text-right text-emerald-700">{yen(subtotal)}</td>
                        </tr>
                        {open && children.map((c) => (
                          <tr key={c.id} className="text-slate-600">
                            <td className="py-1.5 pl-6">
                              <span className="text-xs font-mono text-slate-300 mr-2">{c.code}</span>
                              {c.name}
                            </td>
                            <td className="py-1.5 text-right">
                              {yen(latestBalance(c.balances, year))}
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                  })}
                  <tr className="font-bold border-t border-slate-200">
                    <td className="py-2.5 text-slate-800">資産合計</td>
                    <td className="py-2.5 text-right text-emerald-700">{yen(totalAsset)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 負債・純資産の部 */}
            <div className="card">
              <h2 className="section-title">負債・純資産の部</h2>
              {topLiabs.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100">
                      <th className="text-left py-1.5 font-medium">勘定科目</th>
                      <th className="text-right py-1.5 font-medium">{year}年末残高</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {topLiabs.map((a) => {
                      const children = childrenOf(a.id);
                      const subtotal = children.reduce((s, c) => s + latestBalance(c.balances, year), 0);
                      const open = expandedIds.has(a.id);
                      return (
                        <>
                          <tr
                            key={a.id}
                            className="font-medium bg-slate-50/60 cursor-pointer select-none hover:bg-slate-100/80"
                            onClick={() => toggle(a.id)}
                          >
                            <td className="py-2 text-slate-800">
                              <span className="inline-flex items-center gap-1">
                                <svg className="w-3 h-3 text-slate-400 shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                                <span className="text-xs font-mono text-slate-400 mr-1">{a.code}</span>
                                {a.name}
                              </span>
                            </td>
                            <td className="py-2 text-right text-rose-700">{yen(subtotal)}</td>
                          </tr>
                          {open && children.map((c) => (
                            <tr key={c.id} className="text-slate-600">
                              <td className="py-1.5 pl-6">
                                <span className="text-xs font-mono text-slate-300 mr-2">{c.code}</span>
                                {c.name}
                              </td>
                              <td className="py-1.5 text-right">
                                {yen(latestBalance(c.balances, year))}
                              </td>
                            </tr>
                          ))}
                        </>
                      );
                    })}
                    <tr className="font-bold border-t border-slate-200">
                      <td className="py-2 text-slate-800">負債合計</td>
                      <td className="py-2 text-right text-rose-700">{yen(totalLiab)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {topLiabs.length === 0 && (
                <p className="text-xs text-slate-400 mt-2 mb-4">負債データなし</p>
              )}
              <div className="pt-3 border-t border-slate-200 flex justify-between font-bold text-sm">
                <span className="text-slate-800">純資産</span>
                <span className={netWorth >= 0 ? "text-indigo-700" : "text-red-700"}>
                  {yen(netWorth)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
