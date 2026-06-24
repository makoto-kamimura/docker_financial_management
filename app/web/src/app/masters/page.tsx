"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
};
type Department = { id: number; name: string; manager: string | null };

const CATEGORIES = [
  { value: "REVENUE",   label: "収入" },
  { value: "COGS",      label: "変動費" },
  { value: "EXPENSE",   label: "固定費" },
  { value: "PROFIT",    label: "貯蓄/利益" },
  { value: "ASSET",     label: "資産" },
  { value: "LIABILITY", label: "負債" },
  { value: "OTHER",     label: "その他" },
];

const CATEGORY_BADGE: Record<string, string> = {
  REVENUE:   "bg-blue-50 text-blue-700",
  COGS:      "bg-orange-50 text-orange-700",
  EXPENSE:   "bg-amber-50 text-amber-700",
  PROFIT:    "bg-green-50 text-green-700",
  ASSET:     "bg-emerald-50 text-emerald-700",
  LIABILITY: "bg-rose-50 text-rose-700",
  OTHER:     "bg-slate-100 text-slate-600",
};

const BLANK_ACCT = { code: "", name: "", category: "OTHER", parentCode: "" };
const BLANK_DEPT = { name: "", manager: "" };

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

  // 勘定科目フォーム
  const [acct, setAcct] = useState(BLANK_ACCT);
  const [editAcct, setEditAcct] = useState<Account | null>(null);
  const [editAcctCode, setEditAcctCode] = useState("");
  const [editAcctName, setEditAcctName] = useState("");
  const [editAcctCategory, setEditAcctCategory] = useState("OTHER");
  const [editMsg, setEditMsg] = useState<string | null>(null);

  // 部門フォーム
  const [dept, setDept] = useState(BLANK_DEPT);
  const [editDept, setEditDept] = useState<Department | null>(null);

  // ── 勘定科目 CRUD ───────────────────────────────────────────
  async function addAccount(e: { preventDefault(): void }) {
    e.preventDefault();
    const body: Record<string, string> = { code: acct.code, name: acct.name, category: acct.category };
    if (acct.parentCode) body.parentCode = acct.parentCode;
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setAcct(BLANK_ACCT);
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  function startEditAcct(a: Account) {
    setEditAcct(a);
    setEditAcctCode(a.code);
    setEditAcctName(a.name);
    setEditAcctCategory(a.category);
    setEditMsg(null);
  }

  async function saveEditAcct() {
    if (!editAcct) return;
    setEditMsg(null);
    const res = await fetch(`/api/accounts/${editAcct.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: editAcctCode, name: editAcctName, category: editAcctCategory }),
    });
    if (!res.ok) {
      const json = await res.json();
      setEditMsg(json.error ?? "保存に失敗しました");
      return;
    }
    setEditAcct(null);
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  async function deleteAccount(a: Account) {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = await res.json();
      alert(error);
      return;
    }
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  // ── 部門 CRUD ───────────────────────────────────────────────
  async function addDepartment(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: dept.name, ...(dept.manager ? { manager: dept.manager } : {}) }),
    });
    setDept(BLANK_DEPT);
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  async function saveEditDept() {
    if (!editDept) return;
    await fetch(`/api/departments/${editDept.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editDept.name, manager: editDept.manager ?? "" }),
    });
    setEditDept(null);
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  async function deleteDept(d: Department) {
    if (!confirm(`「${d.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/departments/${d.id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = await res.json();
      alert(error);
      return;
    }
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  return (
    <AppShell>
      {/* 編集モーダル: 勘定科目 */}
      {editAcct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">勘定科目を編集</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">コード</label>
                <input
                  className="input-field w-full font-mono"
                  placeholder="コード"
                  value={editAcctCode}
                  onChange={(e) => setEditAcctCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">名称（文言）</label>
                <input
                  className="input-field w-full"
                  placeholder="名称"
                  value={editAcctName}
                  onChange={(e) => setEditAcctName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">カテゴリ</label>
                <select
                  className="input-field w-full"
                  value={editAcctCategory}
                  onChange={(e) => setEditAcctCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            {editMsg && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{editMsg}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditAcct} className="btn-primary flex-1 py-1.5 text-sm">保存</button>
              <button onClick={() => setEditAcct(null)} className="btn-secondary flex-1 py-1.5 text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル: 部門 */}
      {editDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">部門を編集</h3>
            <div className="space-y-3">
              <input
                className="input-field w-full"
                placeholder="部門名"
                value={editDept.name}
                onChange={(e) => setEditDept({ ...editDept, name: e.target.value })}
              />
              <input
                className="input-field w-full"
                placeholder="担当者名（任意）"
                value={editDept.manager ?? ""}
                onChange={(e) => setEditDept({ ...editDept, manager: e.target.value })}
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditDept} className="btn-primary flex-1 py-1.5 text-sm">保存</button>
              <button onClick={() => setEditDept(null)} className="btn-secondary flex-1 py-1.5 text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="page-title">マスタ管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">勘定科目・部門の管理（コードと文言は編集ボタンから変更できます）</p>
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
              className="input-field w-20 font-mono"
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
            <input
              placeholder="親コード（任意）"
              value={acct.parentCode}
              onChange={(e) => setAcct({ ...acct, parentCode: e.target.value })}
              className="input-field w-28 font-mono"
            />
            <button type="submit" className="btn-primary px-3">追加</button>
          </form>
          <ul className="divide-y divide-slate-100">
            {accounts?.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 group">
                <span className="text-xs font-mono text-slate-400 w-14 shrink-0">{a.code}</span>
                <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
                  {a.parent && <span className="text-xs text-slate-400 mr-1">└ </span>}
                  {a.name}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${CATEGORY_BADGE[a.category] ?? CATEGORY_BADGE.OTHER}`}>
                  {CATEGORIES.find((c) => c.value === a.category)?.label}
                </span>
                <button
                  onClick={() => startEditAcct(a)}
                  className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="コード・文言を編集"
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteAccount(a)}
                  className="text-xs text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="削除"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 部門 */}
        <div className="card">
          <h2 className="section-title">部門・担当</h2>
          <form onSubmit={addDepartment} className="flex gap-2 mb-4 flex-wrap">
            <input
              placeholder="部門名"
              value={dept.name}
              onChange={(e) => setDept({ ...dept, name: e.target.value })}
              required
              className="input-field flex-1 min-w-28"
            />
            <input
              placeholder="担当者名（任意）"
              value={dept.manager}
              onChange={(e) => setDept({ ...dept, manager: e.target.value })}
              className="input-field w-28"
            />
            <button type="submit" className="btn-primary px-3">追加</button>
          </form>
          <ul className="divide-y divide-slate-100">
            {departments?.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2 group">
                <span className="text-sm text-slate-800 flex-1">{d.name}</span>
                {d.manager && (
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    担当: {d.manager}
                  </span>
                )}
                <button
                  onClick={() => setEditDept(d)}
                  className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="編集"
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteDept(d)}
                  className="text-xs text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="削除"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
