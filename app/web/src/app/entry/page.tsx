"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";

// ── 型定義 ───────────────────────────────────────────────
type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
};
type Department = { id: number; name: string; manager: string | null };

type ImportResult = {
  inserted: number;
  errors: { row: number; message: string }[];
};

type RecentHistory = {
  historyId: number;
  recordId: number;
  action: "create" | "update" | "delete";
  amount: number;
  changedAt: string;
  userId: number | null;
  account: { code: string; name: string; category: string };
  period: { fiscalYear: number; month: number };
};

// ── 定数 ────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = { create: "登録", update: "更新", delete: "削除" };
const ACTION_COLOR: Record<string, string> = {
  create: "text-green-700 bg-green-50",
  update: "text-amber-700 bg-amber-50",
  delete: "text-red-700 bg-red-50",
};

const GROUP_ORDER = ["ASSET", "LIABILITY", "REVENUE", "COGS", "EXPENSE", "PROFIT", "OTHER"] as const;
const GROUP_LABELS: Record<string, string> = {
  ASSET:     "資産",
  LIABILITY: "負債",
  REVENUE:   "収入",
  COGS:      "変動費",
  EXPENSE:   "固定費",
  PROFIT:    "貯蓄/利益",
  OTHER:     "その他",
};

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

const yen = (v: number) => v.toLocaleString("ja-JP") + "円";
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const now = new Date();
const THIS_YEAR  = now.getFullYear();
const THIS_MONTH = now.getMonth() + 1;

export default function EntryPage() {
  const queryClient = useQueryClient();

  // ── クエリ ───────────────────────────────────────────
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => (await (await fetch("/api/accounts")).json()).data,
  });

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> =>
      (await (await fetch("/api/departments")).json()).data,
  });

  const { data: recentHistory, isLoading: histLoading } = useQuery({
    queryKey: ["recent-history"],
    queryFn: async (): Promise<RecentHistory[]> => {
      const res = await fetch("/api/financials/recent?limit=30");
      return (await res.json()).data ?? [];
    },
    refetchInterval: 30_000,
  });

  // ── タブ ────────────────────────────────────────────
  const [tab, setTab] = useState<"manual" | "csv">("manual");

  // ── 手入力フォーム ──────────────────────────────────
  const [form, setForm] = useState({ accountCode: "", fiscalYear: THIS_YEAR, month: THIS_MONTH, amount: 0 });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 勘定科目名インライン編集（手入力タブ）
  const [nameEditOpen,   setNameEditOpen]   = useState(false);
  const [nameEditValue,  setNameEditValue]  = useState("");
  const [nameEditMsg,    setNameEditMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [nameEditSaving, setNameEditSaving] = useState(false);

  // ── CSV インポート ────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError,  setImportError]  = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState(false);

  // ── マスタ: 勘定科目 ─────────────────────────────
  const [acct,         setAcct]        = useState(BLANK_ACCT);
  const [editAcct,     setEditAcct]    = useState<Account | null>(null);
  const [editAcctCode, setEditAcctCode] = useState("");
  const [editAcctName, setEditAcctName] = useState("");
  const [editAcctCat,  setEditAcctCat]  = useState("OTHER");
  const [acctEditMsg,  setAcctEditMsg]  = useState<string | null>(null);

  // ── マスタ: 部門 ─────────────────────────────────
  const [dept,     setDept]     = useState(BLANK_DEPT);
  const [editDept, setEditDept] = useState<Department | null>(null);

  // ── カテゴリ別グループ化 ──────────────────────────
  const byCategory = (accounts ?? []).reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  const selectedAccount = (accounts ?? []).find((a) => a.code === form.accountCode) ?? null;

  // ── 手入力ハンドラ ───────────────────────────────
  function onAccountChange(code: string) {
    setForm((f) => ({ ...f, accountCode: code }));
    setNameEditOpen(false);
    setNameEditMsg(null);
  }

  function openNameEdit() {
    if (!selectedAccount) return;
    setNameEditValue(selectedAccount.name);
    setNameEditMsg(null);
    setNameEditOpen(true);
  }

  async function saveNameEdit() {
    if (!selectedAccount) return;
    setNameEditSaving(true);
    setNameEditMsg(null);
    const res = await fetch(`/api/accounts/${selectedAccount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameEditValue }),
    });
    const json = await res.json();
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setNameEditMsg({ ok: true, text: "保存しました。" });
      setNameEditOpen(false);
    } else {
      setNameEditMsg({ ok: false, text: json.error ?? "保存に失敗しました。" });
    }
    setNameEditSaving(false);
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/financials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountCode: form.accountCode,
        fiscalYear: Number(form.fiscalYear),
        month: Number(form.month),
        amount: Number(form.amount),
      }),
    });
    setMessage(res.ok ? { ok: true, text: "登録しました。" } : { ok: false, text: "登録に失敗しました。" });
  }

  // ── CSV ハンドラ ─────────────────────────────────
  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await fetch("/api/financials/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: file,
      });
      setImportResult(await res.json() as ImportResult);
    } catch {
      setImportError("ファイルの送信中にエラーが発生しました。");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) importFile(file);
  }

  // ── 勘定科目 CRUD ────────────────────────────────
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
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }

  function startEditAcct(a: Account) {
    setEditAcct(a);
    setEditAcctCode(a.code);
    setEditAcctName(a.name);
    setEditAcctCat(a.category);
    setAcctEditMsg(null);
  }

  async function saveEditAcct() {
    if (!editAcct) return;
    setAcctEditMsg(null);
    const res = await fetch(`/api/accounts/${editAcct.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: editAcctCode, name: editAcctName, category: editAcctCat }),
    });
    if (!res.ok) {
      setAcctEditMsg((await res.json()).error ?? "保存に失敗しました");
      return;
    }
    setEditAcct(null);
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }

  async function deleteAccount(a: Account) {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) { alert((await res.json()).error); return; }
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }

  // ── 部門 CRUD ────────────────────────────────────
  async function addDepartment(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: dept.name, ...(dept.manager ? { manager: dept.manager } : {}) }),
    });
    setDept(BLANK_DEPT);
    queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  async function saveEditDept() {
    if (!editDept) return;
    await fetch(`/api/departments/${editDept.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editDept.name, manager: editDept.manager ?? "" }),
    });
    setEditDept(null);
    queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  async function deleteDept(d: Department) {
    if (!confirm(`「${d.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/departments/${d.id}`, { method: "DELETE" });
    if (!res.ok) { alert((await res.json()).error); return; }
    queryClient.invalidateQueries({ queryKey: ["departments"] });
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
                <input className="input-field w-full font-mono" value={editAcctCode}
                  onChange={(e) => setEditAcctCode(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">名称</label>
                <input className="input-field w-full" value={editAcctName}
                  onChange={(e) => setEditAcctName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">カテゴリ</label>
                <select className="input-field w-full" value={editAcctCat}
                  onChange={(e) => setEditAcctCat(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            {acctEditMsg && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{acctEditMsg}</p>
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
              <input className="input-field w-full" placeholder="部門名" value={editDept.name}
                onChange={(e) => setEditDept({ ...editDept, name: e.target.value })} />
              <input className="input-field w-full" placeholder="担当者名（任意）" value={editDept.manager ?? ""}
                onChange={(e) => setEditDept({ ...editDept, manager: e.target.value })} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditDept} className="btn-primary flex-1 py-1.5 text-sm">保存</button>
              <button onClick={() => setEditDept(null)} className="btn-secondary flex-1 py-1.5 text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="page-title">実績管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">月次の財務実績を登録します</p>
      </div>

      {/* タブ切り替え */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["manual", "csv"] as const).map((t) => (
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
            {t === "manual" ? "手入力" : "CSV インポート"}
          </button>
        ))}
      </div>

      {/* ── 手入力 ─────────────────────────────────── */}
      {tab === "manual" && (
        <div className="card max-w-md">
          <h2 className="section-title">新規登録</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">勘定科目</label>
              <div className="flex gap-2">
                <select
                  value={form.accountCode}
                  onChange={(e) => onAccountChange(e.target.value)}
                  required
                  className="input-field flex-1"
                >
                  <option value="">選択してください</option>
                  {GROUP_ORDER.map((cat) => {
                    const items = byCategory[cat] ?? [];
                    if (items.length === 0) return null;
                    return (
                      <optgroup key={cat} label={GROUP_LABELS[cat]}>
                        {items.map((a) => (
                          <option key={a.id} value={a.code}>{a.code} {a.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {selectedAccount && !nameEditOpen && (
                  <button
                    type="button"
                    onClick={openNameEdit}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    名前を編集
                  </button>
                )}
              </div>
              {nameEditOpen && selectedAccount && (
                <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <p className="text-xs font-medium text-slate-600">「{selectedAccount.name}」の名前を変更</p>
                  <div className="flex gap-2">
                    <input type="text" value={nameEditValue}
                      onChange={(e) => setNameEditValue(e.target.value)}
                      className="input-field flex-1 text-sm" placeholder="新しい名前" />
                    <button type="button" onClick={saveNameEdit}
                      disabled={nameEditSaving || nameEditValue.trim() === ""}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {nameEditSaving ? "保存中…" : "保存"}
                    </button>
                    <button type="button" onClick={() => { setNameEditOpen(false); setNameEditMsg(null); }}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors">
                      キャンセル
                    </button>
                  </div>
                  {nameEditMsg && (
                    <p className={`text-xs rounded px-2 py-1 ${nameEditMsg.ok ? "text-green-700 bg-green-50" : "text-red-600 bg-red-50"}`}>
                      {nameEditMsg.text}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">年度</label>
                <input type="number" value={form.fiscalYear}
                  onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) })}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">月</label>
                <input type="number" min={1} max={12} value={form.month}
                  onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
                  className="input-field" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">金額（円）</label>
              <input type="number" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className="input-field" />
            </div>
            {message && (
              <p className={`text-sm rounded-lg px-3 py-2 border ${message.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}>
                {message.text}
              </p>
            )}
            <button type="submit" className="btn-primary w-full py-2.5">登録</button>
          </form>
        </div>
      )}

      {/* ── CSV インポート ─────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`card cursor-pointer border-2 border-dashed transition-colors text-center py-12 ${
              dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
            }`}
          >
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
            {importing ? (
              <div className="space-y-2">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-slate-500">インポート中…</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl">📂</p>
                <p className="text-sm font-medium text-slate-700">クリックしてファイルを選択 または ドラッグ＆ドロップ</p>
                <p className="text-xs text-slate-400">CSV ファイル (.csv) に対応</p>
              </div>
            )}
          </div>
          {importResult && (
            <div className={`card border ${importResult.errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{importResult.errors.length === 0 ? "✅" : "⚠️"}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{importResult.inserted.toLocaleString()} 件を登録しました</p>
                  {importResult.errors.length > 0 && (
                    <p className="text-xs text-amber-700">{importResult.errors.length} 件のエラーがあります</p>
                  )}
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-3 max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-amber-200">
                        <th className="text-left pb-1 w-16">行番号</th>
                        <th className="text-left pb-1">エラー内容</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {importResult.errors.map((err, i) => (
                        <tr key={i} className="text-slate-600">
                          <td className="py-1 font-mono">{err.row}</td>
                          <td className="py-1">{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {importError && (
            <div className="card border border-red-200 bg-red-50">
              <p className="text-sm text-red-700">{importError}</p>
            </div>
          )}
          <div className="card bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">CSV フォーマット</h3>
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`accountCode,fiscalYear,month,amount
H1000,${THIS_YEAR},1,350000
H2000,${THIS_YEAR},1,45000
HA101,${THIS_YEAR},12,500000`}</pre>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li><span className="font-medium">accountCode</span>：勘定科目コード（マスタに登録済みのもの）</li>
              <li><span className="font-medium">fiscalYear</span>：会計年度（例: {THIS_YEAR}）</li>
              <li><span className="font-medium">month</span>：月（1〜12）</li>
              <li><span className="font-medium">amount</span>：金額（円）</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 入力履歴 ──────────────────────────────── */}
      <div className="mt-10">
        <h2 className="section-title mb-4">入力履歴（直近 30 件）</h2>
        {histLoading ? (
          <LoadingSpinner label="履歴を読み込み中…" />
        ) : recentHistory && recentHistory.length > 0 ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2 pr-4 font-medium">日時</th>
                  <th className="text-left py-2 pr-4 font-medium">操作</th>
                  <th className="text-left py-2 pr-4 font-medium">勘定科目</th>
                  <th className="text-left py-2 pr-4 font-medium">期間</th>
                  <th className="text-right py-2 font-medium">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentHistory.map((h) => (
                  <tr key={h.historyId} className="hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-500 whitespace-nowrap text-xs font-mono">{fmtDate(h.changedAt)}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLOR[h.action] ?? ""}`}>
                        {ACTION_LABEL[h.action] ?? h.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">
                      <span className="font-mono text-xs text-slate-400 mr-1">{h.account.code}</span>
                      {h.account.name}
                    </td>
                    <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{h.period.fiscalYear}年 {h.period.month}月</td>
                    <td className="py-2 text-right font-mono text-slate-800">{yen(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">まだ入力履歴はありません。</p>
        )}
      </div>

      {/* ── マスタ管理 ──────────────────────────────── */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* 勘定科目 */}
        <div className="card">
          <h2 className="section-title">勘定科目</h2>
          <form onSubmit={addAccount} className="flex gap-2 mb-4 flex-wrap">
            <input placeholder="コード" value={acct.code}
              onChange={(e) => setAcct({ ...acct, code: e.target.value })}
              required className="input-field w-20 font-mono" />
            <input placeholder="名称" value={acct.name}
              onChange={(e) => setAcct({ ...acct, name: e.target.value })}
              required className="input-field flex-1 min-w-28" />
            <select value={acct.category} onChange={(e) => setAcct({ ...acct, category: e.target.value })}
              className="input-field w-24">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input placeholder="親コード（任意）" value={acct.parentCode}
              onChange={(e) => setAcct({ ...acct, parentCode: e.target.value })}
              className="input-field w-28 font-mono" />
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
                <button onClick={() => startEditAcct(a)}
                  className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="編集">✏️</button>
                <button onClick={() => deleteAccount(a)}
                  className="text-xs text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="削除">🗑</button>
              </li>
            ))}
          </ul>
        </div>

        {/* 部門 */}
        <div className="card">
          <h2 className="section-title">部門・担当</h2>
          <form onSubmit={addDepartment} className="flex gap-2 mb-4 flex-wrap">
            <input placeholder="部門名" value={dept.name}
              onChange={(e) => setDept({ ...dept, name: e.target.value })}
              required className="input-field flex-1 min-w-28" />
            <input placeholder="担当者名（任意）" value={dept.manager}
              onChange={(e) => setDept({ ...dept, manager: e.target.value })}
              className="input-field w-28" />
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
                <button onClick={() => setEditDept(d)}
                  className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="編集">✏️</button>
                <button onClick={() => deleteDept(d)}
                  className="text-xs text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="削除">🗑</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
