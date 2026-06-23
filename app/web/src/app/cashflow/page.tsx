"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CashFlowSankey, type SankeyData } from "@/components/CashFlowSankey";

type CashFlowResponse = {
  year: number | string;
  totals: {
    revenue: number;
    cogs: number;
    expense: number;
    grossProfit: number;
    operatingProfit: number;
  };
  graph: SankeyData;
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export default function CashFlowPage() {
  const [year, setYear] = useState("2025");

  const { data, isLoading, error } = useQuery({
    queryKey: ["cashflow", year],
    queryFn: async (): Promise<CashFlowResponse> => {
      const q = year === "all" ? "" : `?year=${year}`;
      const res = await fetch(`/api/cashflow${q}`);
      if (!res.ok) throw new Error("failed to load cashflow");
      return res.json();
    },
  });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">資金フロー図</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            勘定科目の集計から、売上 → 原価 / 利益の流れを自動生成します
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600">対象期間</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="2025">2025年</option>
            <option value="all">全期間</option>
          </select>
        </div>
      </div>

      <div className="card">
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
        {data && <CashFlowSankey data={data.graph} />}
      </div>

      {data && (
        <div className="card mt-6 max-w-md">
          <h2 className="section-title">内訳</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {[
                ["売上高", data.totals.revenue],
                ["売上原価", data.totals.cogs],
                ["売上総利益", data.totals.grossProfit],
                ["販管費", data.totals.expense],
                ["営業利益", data.totals.operatingProfit],
              ].map(([label, value]) => (
                <tr key={label as string}>
                  <td className="py-2 text-slate-700">{label}</td>
                  <td className="py-2 text-right tabular-nums text-slate-900">{yen(value as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
