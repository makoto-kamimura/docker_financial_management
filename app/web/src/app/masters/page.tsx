"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type Account = { id: number; code: string; name: string; category: string };
type Department = { id: number; name: string };

const CATEGORIES = [
  { value: "REVENUE", label: "売上" },
  { value: "COGS", label: "売上原価" },
  { value: "EXPENSE", label: "販管費" },
  { value: "PROFIT", label: "利益" },
  { value: "OTHER", label: "その他" },
];

const CATEGORY_BADGE: Record<string, string> = {
  REVENUE: "bg-blue-50 text-blue-700",
  COGS: "bg-orange-50 text-orange-700",
  EXPENSE: "bg-amber-50 text-amber-700",
  PROFIT: "bg-green-50 text-green-700",
  OTHER: "bg-slate-100 text-slate-600",
};

export default function MastersPage() {
  const qc = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => (await (await fetch("/api/accounts")).json()).data,
  });
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> =>
      (await (await fetch("/api/departments")).json()).data,
  });

  const [acct, setAcct] = useState({ code: "", name: "", category: "OTHER" });
  const [deptName, setDeptName] = useState("");

  async function addAccount(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acct),
    });
    setAcct({ code: "", name: "", category: "OTHER" });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  async function addDepartment(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deptName }),
    });
    setDeptName("");
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">マスタ管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">勘定科目・部門の管理</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 勘定科目 */}
        <div className="card">
          <h2 className="section-title">勘定科目</h2>
          <form onSubmit={addAccount} className="flex gap-2 mb-4 flex-wrap">
            <input
              placeholder="コード"
              value={acct.code}
              onChange={(e) => setAcct({ ...acct, code: e.target.value })}
              required
              className="input-field w-20"
            />
            <input
              placeholder="名称"
              value={acct.name}
              onChange={(e) => setAcct({ ...acct, name: e.target.value })}
              required
              className="input-field flex-1 min-w-28"
            />
            <select
              value={acct.category}
              onChange={(e) => setAcct({ ...acct, category: e.target.value })}
              className="input-field w-24"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button type="submit" className="btn-primary px-3">追加</button>
          </form>
          <ul className="divide-y divide-slate-100">
            {accounts?.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <span className="text-xs font-mono text-slate-500 w-12">{a.code}</span>
                <span className="text-sm text-slate-800 flex-1">{a.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_BADGE[a.category] ?? CATEGORY_BADGE.OTHER}`}>
                  {CATEGORIES.find((c) => c.value === a.category)?.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 部門 */}
        <div className="card">
          <h2 className="section-title">部門</h2>
          <form onSubmit={addDepartment} className="flex gap-2 mb-4">
            <input
              placeholder="部門名"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              required
              className="input-field flex-1"
            />
            <button type="submit" className="btn-primary px-3">追加</button>
          </form>
          <ul className="divide-y divide-slate-100">
            {departments?.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <span className="text-sm text-slate-800">{d.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
