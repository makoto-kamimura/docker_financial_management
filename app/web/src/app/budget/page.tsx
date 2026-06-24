"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";

type AccountRef = { id: number; code: string; name: string; category: string };
type BudgetRow = {
  id: number;
  amount: number;
  account: { id: number; code: string; name: string };
  period: { fiscalYear: number; month: number };
};
type BudgetResponse = { data: BudgetRow[]; years: number[] };

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const yen = (v: number) => Math.round(v).toLocaleString("ja-JP");

const CATEGORY_ORDER = ["REVENUE","COGS","EXPENSE","PROFIT","OTHER","ASSET","LIABILITY"] as const;

function groupByAccount(rows: BudgetRow[]): Map<string, { account: BudgetRow["account"]; byMonth: Map<number, BudgetRow> }> {
  const map = new Map<string, { account: BudgetRow["account"]; byMonth: Map<number, BudgetRow> }>();
  for (const r of rows) {
    if (!map.has(r.account.code)) map.set(r.account.code, { account: r.account, byMonth: new Map() });
    map.get(r.account.code)!.byMonth.set(r.period.month, r);
  }
  return map;
}

export default function BudgetPage() {
  const qc = useQueryClient();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [form, setForm] = useState({ accountCode: "", month: 1, amount: "" });
  const [editCell, setEditCell] = useState<{ id: number; amount: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", selectedYear],
    queryFn: async (): Promise<BudgetResponse> => {
      const url = selectedYear ? `/api/budgets?year=${selectedYear}` : "/api/budgets";
      const res = await fetch(url);
      return res.json();
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const year = selectedYear ?? data?.years.at(-1) ?? new Date().getFullYear();
  const grouped = groupByAccount(data?.data ?? []);

  // 勘定科目をカテゴリ順に並べる（アカウントリスト準拠）
  const sortedAccounts = accounts
    ? accounts
        .filter((a) => grouped.has(a.code))
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.category as never) - CATEGORY_ORDER.indexOf(b.category as never))
    : Array.from(grouped.values()).map((g) => ({ id: 0, code: g.account.code, name: g.account.name, category: "" }));

  async function addBudget(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!form.accountCode || !form.amount) return;
    await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountCode: form.accountCode,
        fiscalYear: year,
        month: Number(form.month),
        amount: Number(form.amount),
      }),
    });
    setForm({ ...form, amount: "" });
    qc.invalidateQueries({ queryKey: ["budgets"] });
  }

  async function saveCell() {
    if (!editCell) return;
    await fetch(`/api/budgets/${editCell.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(editCell.amount) }),
    });
    setEditCell(null);
    qc.invalidateQueries({ queryKey: ["budgets"] });
  }

  async function deleteBudget(id: number) {
    await fetch(`/api/budgets/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["budgets"] });
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-title">予算管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">年度別・月次予算の登録・編集</p>
        </div>
        {(data?.years ?? []).length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">年度</label>
            <select
              value={year}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {data?.years.map((y) => <option key={y} value={y}>{y}年度</option>)}
            </select>
          </div>
        )}
      </div>

      {/* 登録フォーム */}
      <div className="card mb-6">
        <h2 className="section-title mb-3">予算を追加</h2>
        <form onSubmit={addBudget} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 min-w-48">
            <label className="text-xs text-slate-500">勘定科目</label>
            <select value={form.accountCode} onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
              required className="input-field">
              <option value="">選択</option>
              {accounts?.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-20">
            <label className="text-xs text-slate-500">月</label>
            <select value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
              className="input-field">
              {MONTHS.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs text-slate-500">予算金額（円）</label>
            <input type="number" placeholder="例: 350000"
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required className="input-field" />
          </div>
          <button type="submit" className="btn-primary px-4">登録</button>
        </form>
      </div>

      {/* 予算テーブル */}
      {isLoading && <LoadingSpinner />}

      {!isLoading && sortedAccounts.length === 0 && (
        <EmptyState title="予算データがありません" description="上のフォームから予算を登録してください。" />
      )}

      {sortedAccounts.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-44">勘定科目</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap min-w-24">{m}月</th>
                  ))}
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 min-w-28">年間合計</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAccounts.map((acct) => {
                  const g = grouped.get(acct.code);
                  if (!g) return null;
                  const annual = MONTHS.reduce((s, m) => s + (Number(g.byMonth.get(m)?.amount) || 0), 0);
                  return (
                    <tr key={acct.code} className="hover:bg-slate-50 group">
                      <td className="sticky left-0 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium">
                        <span className="text-xs font-mono text-slate-400 mr-1.5">{acct.code}</span>
                        <span className="text-slate-800">{acct.name}</span>
                      </td>
                      {MONTHS.map((m) => {
                        const cell = g.byMonth.get(m);
                        const isEditing = editCell && cell && editCell.id === cell.id;
                        return (
                          <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                            {isEditing ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="number"
                                  value={editCell.amount}
                                  onChange={(e) => setEditCell({ ...editCell, amount: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveCell(); if (e.key === "Escape") setEditCell(null); }}
                                  autoFocus
                                  className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                                />
                                <button onClick={saveCell} className="text-xs text-indigo-600">✓</button>
                              </div>
                            ) : cell ? (
                              <div className="flex items-center justify-end gap-1 group/cell">
                                <span>{yen(Number(cell.amount))}</span>
                                <button
                                  onClick={() => setEditCell({ id: cell.id, amount: String(cell.amount) })}
                                  className="text-xs text-slate-300 hover:text-indigo-500 opacity-0 group-hover/cell:opacity-100"
                                >✏️</button>
                                <button
                                  onClick={() => deleteBudget(cell.id)}
                                  className="text-xs text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100"
                                >✕</button>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">
                        {annual > 0 ? yen(annual) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
