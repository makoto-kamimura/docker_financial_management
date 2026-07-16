"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { useViewMode } from "@/lib/use-view-mode";
import { displayName } from "@/lib/display-name";

// ── 型定義 ─────────────────────────────────────────────────────────
type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
  soleName?: string | null;
  corporateName?: string | null;
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
  account: {
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  };
  period: { fiscalYear: number; month: number };
};

type JournalDetail = {
  id: number;
  side: "debit" | "credit";
  amount: number;
  account: {
    id: number;
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  };
};
type JournalEntry = {
  id: number;
  transactionDate: string;
  description: string;
  paymentMethod: string;
  details: JournalDetail[];
};

// ── 定数 ───────────────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = { create: "登録", update: "更新", delete: "削除" };
const ACTION_COLOR: Record<string, string> = {
  create: "text-green-700 bg-green-50",
  update: "text-amber-700 bg-amber-50",
  delete: "text-red-700 bg-red-50",
};

const GROUP_ORDER = [
  "ASSET",
  "LIABILITY",
  "REVENUE",
  "COGS",
  "EXPENSE",
  "PROFIT",
  "OTHER",
] as const;
const GROUP_LABELS: Record<string, string> = {
  ASSET: "資産",
  LIABILITY: "負債",
  REVENUE: "収入",
  COGS: "変動費",
  EXPENSE: "固定費",
  PROFIT: "貯蓄/利益",
  OTHER: "その他",
};

const CATEGORIES = [
  { value: "REVENUE", label: "収入" },
  { value: "COGS", label: "変動費" },
  { value: "EXPENSE", label: "固定費" },
  { value: "PROFIT", label: "貯蓄/利益" },
  { value: "ASSET", label: "資産" },
  { value: "LIABILITY", label: "負債" },
  { value: "OTHER", label: "その他" },
];

const CATEGORY_BADGE: Record<string, string> = {
  REVENUE: "bg-blue-50 text-blue-700",
  COGS: "bg-orange-50 text-orange-700",
  EXPENSE: "bg-amber-50 text-amber-700",
  PROFIT: "bg-green-50 text-green-700",
  ASSET: "bg-emerald-50 text-emerald-700",
  LIABILITY: "bg-rose-50 text-rose-700",
  OTHER: "bg-slate-100 text-slate-600",
};

const BLANK_ACCT = { code: "", name: "", category: "OTHER", parentCode: "" };
const BLANK_DEPT = { name: "", manager: "" };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const PAY_METHODS = [
  { value: "cash", label: "現金" },
  { value: "bank", label: "銀行" },
  { value: "card", label: "カード" },
  { value: "transfer", label: "振込" },
];
const INCOME_CATS = ["REVENUE", "PROFIT"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];
const ASSET_CATS = ["ASSET"];

const BLANK_CAL_FORM = {
  description: "",
  accountCode: "",
  counterAccountCode: "",
  amount: "",
  direction: "expense" as "income" | "expense",
  paymentMethod: "cash",
};

const yen = (v: number) => v.toLocaleString("ja-JP") + "円";
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function entryAmount(e: JournalEntry): { income: number; expense: number } {
  let income = 0,
    expense = 0;
  for (const d of e.details) {
    const amt = Number(d.amount);
    if (INCOME_CATS.includes(d.account.category)) {
      if (d.side === "credit") income += amt;
    }
    if (EXPENSE_CATS.includes(d.account.category)) {
      if (d.side === "debit") expense += amt;
    }
  }
  return { income, expense };
}

const now = new Date();
const THIS_YEAR = now.getFullYear();
const THIS_MONTH = now.getMonth() + 1;

type Tab = "manual" | "calendar" | "csv";

// ── ページ ─────────────────────────────────────────────────────────
export default function EntryPage() {
  const queryClient = useQueryClient();
  const sysMode = useViewMode();

  // ── タブ ──────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("manual");

  // ── クエリ ────────────────────────────────────────────────────
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

  // ── 手入力フォーム ────────────────────────────────────────────
  const [form, setForm] = useState({
    accountCode: "",
    fiscalYear: THIS_YEAR,
    month: THIS_MONTH,
    amount: 0,
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [nameEditValue, setNameEditValue] = useState("");
  const [nameEditMsg, setNameEditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nameEditSaving, setNameEditSaving] = useState(false);

  // ── CSV インポート ─────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── カレンダー ────────────────────────────────────────────────
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  const [calForm, setCalForm] = useState(BLANK_CAL_FORM);
  const [calSaving, setCalSaving] = useState(false);
  const [calError, setCalError] = useState("");

  const { data: journalData, isLoading: calLoading } = useQuery({
    queryKey: ["actuals", viewYear, viewMonth],
    queryFn: async (): Promise<{ data: JournalEntry[] }> =>
      (await fetch(`/api/actuals?year=${viewYear}&month=${viewMonth}`)).json(),
    enabled: tab === "calendar",
  });

  const calEntries = journalData?.data ?? [];

  const byDay = useMemo(() => {
    const m = new Map<number, JournalEntry[]>();
    for (const e of calEntries) {
      const d = new Date(e.transactionDate).getDate();
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(e);
    }
    return m;
  }, [calEntries]);

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  const incomeAccounts = (accounts ?? []).filter((a) => INCOME_CATS.includes(a.category));
  const expenseAccounts = (accounts ?? []).filter((a) => EXPENSE_CATS.includes(a.category));
  const assetAccounts = (accounts ?? []).filter((a) => ASSET_CATS.includes(a.category));
  const calMainAccounts = calForm.direction === "income" ? incomeAccounts : expenseAccounts;

  // ── マスタ: 勘定科目 ─────────────────────────────────────────
  const [acct, setAcct] = useState(BLANK_ACCT);
  const [editAcct, setEditAcct] = useState<Account | null>(null);
  const [editAcctCode, setEditAcctCode] = useState("");
  const [editAcctName, setEditAcctName] = useState("");
  const [editAcctCat, setEditAcctCat] = useState("OTHER");
  const [acctEditMsg, setAcctEditMsg] = useState<string | null>(null);

  // ── マスタ: 部門 ─────────────────────────────────────────────
  const [dept, setDept] = useState(BLANK_DEPT);
  const [editDept, setEditDept] = useState<Department | null>(null);

  const byCategory = (accounts ?? []).reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  const selectedAccount = (accounts ?? []).find((a) => a.code === form.accountCode) ?? null;

  // ── 手入力ハンドラ ───────────────────────────────────────────
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
    setMessage(
      res.ok ? { ok: true, text: "登録しました。" } : { ok: false, text: "登録に失敗しました。" },
    );
  }

  // ── CSV ハンドラ ─────────────────────────────────────────────
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
      setImportResult((await res.json()) as ImportResult);
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

  // ── カレンダーハンドラ ───────────────────────────────────────
  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else setViewMonth((m) => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else setViewMonth((m) => m + 1);
    setSelectedDay(null);
  }

  async function handleCalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDay) return;
    setCalSaving(true);
    setCalError("");
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    const res = await fetch("/api/actuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dateStr,
        description: calForm.description,
        accountCode: calForm.accountCode,
        counterAccountCode: calForm.counterAccountCode,
        amount: Number(calForm.amount),
        direction: calForm.direction,
        paymentMethod: calForm.paymentMethod,
      }),
    });
    if (res.ok) {
      setCalForm(BLANK_CAL_FORM);
      queryClient.invalidateQueries({ queryKey: ["actuals", viewYear, viewMonth] });
    } else {
      const j = (await res.json()) as { error?: string };
      setCalError(j.error ?? "登録に失敗しました");
    }
    setCalSaving(false);
  }

  async function handleCalDelete(id: number) {
    await fetch(`/api/actuals?id=${id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["actuals", viewYear, viewMonth] });
  }

  // ── 勘定科目 CRUD ────────────────────────────────────────────
  async function addAccount(e: { preventDefault(): void }) {
    e.preventDefault();
    const body: Record<string, string> = {
      code: acct.code,
      name: acct.name,
      category: acct.category,
    };
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
    if (!res.ok) {
      alert((await res.json()).error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }

  // ── 部門 CRUD ────────────────────────────────────────────────
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
    if (!res.ok) {
      alert((await res.json()).error);
      return;
    }
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
                <input
                  className="input-field w-full font-mono"
                  value={editAcctCode}
                  onChange={(e) => setEditAcctCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">名称</label>
                <input
                  className="input-field w-full"
                  value={editAcctName}
                  onChange={(e) => setEditAcctName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">カテゴリ</label>
                <select
                  className="input-field w-full"
                  value={editAcctCat}
                  onChange={(e) => setEditAcctCat(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {acctEditMsg && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {acctEditMsg}
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditAcct} className="btn-primary flex-1 py-1.5 text-sm">
                保存
              </button>
              <button
                onClick={() => setEditAcct(null)}
                className="btn-secondary flex-1 py-1.5 text-sm"
              >
                キャンセル
              </button>
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
              <button onClick={saveEditDept} className="btn-primary flex-1 py-1.5 text-sm">
                保存
              </button>
              <button
                onClick={() => setEditDept(null)}
                className="btn-secondary flex-1 py-1.5 text-sm"
              >
                キャンセル
              </button>
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
        {(
          [
            ["manual", "明細詳細"],
            ["calendar", "カレンダー"],
            ["csv", "CSV インポート"],
          ] as [Tab, string][]
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

      {/* ── 手入力タブ ────────────────────────────────────────── */}
      {tab === "manual" && (
        <div className="card mb-6">
          <h2 className="section-title mb-4">新規登録</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 w-72">
              <label className="text-xs font-medium text-slate-600">勘定科目</label>
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
                          <option key={a.id} value={a.code}>
                            {a.code} {displayName(a, sysMode)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {selectedAccount && !nameEditOpen && (
                  <button
                    type="button"
                    onClick={openNameEdit}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    名前変更
                  </button>
                )}
              </div>
              {nameEditOpen && selectedAccount && (
                <div className="mt-1 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <p className="text-xs font-medium text-slate-600">
                    「{selectedAccount.name}」の名前を変更
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nameEditValue}
                      onChange={(e) => setNameEditValue(e.target.value)}
                      className="input-field flex-1 text-sm"
                      placeholder="新しい名前"
                    />
                    <button
                      type="button"
                      onClick={saveNameEdit}
                      disabled={nameEditSaving || nameEditValue.trim() === ""}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {nameEditSaving ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNameEditOpen(false);
                        setNameEditMsg(null);
                      }}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                  {nameEditMsg && (
                    <p
                      className={`text-xs rounded px-2 py-1 ${nameEditMsg.ok ? "text-green-700 bg-green-50" : "text-red-600 bg-red-50"}`}
                    >
                      {nameEditMsg.text}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 w-24">
              <label className="text-xs font-medium text-slate-600">年度</label>
              <input
                type="number"
                value={form.fiscalYear}
                onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-xs font-medium text-slate-600">月</label>
              <input
                type="number"
                min={1}
                max={12}
                value={form.month}
                onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <div className="flex flex-col gap-1 w-36">
              <label className="text-xs font-medium text-slate-600">金額（円）</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <button type="submit" className="btn-primary px-5 py-2 self-end ml-auto">
              登録
            </button>
          </form>
          {message && (
            <p
              className={`mt-3 text-sm rounded-lg px-3 py-2 border ${message.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}

      {/* ── カレンダータブ ────────────────────────────────────── */}
      {tab === "calendar" && (
        <div className="flex gap-4 items-start">
          {/* カレンダー */}
          <div className="card flex-1 min-w-0 p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <span className="font-semibold text-slate-800">
                {viewYear}年{viewMonth}月
              </span>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-7 border-b border-slate-100">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={`py-2 text-center text-xs font-medium ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-500"}`}
                >
                  {w}
                </div>
              ))}
            </div>
            {calLoading ? (
              <div className="p-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="grid grid-cols-7">
                {Array.from({ length: totalCells }, (_, i) => {
                  const day = i - firstWeekday + 1;
                  const isValid = day >= 1 && day <= daysInMonth;
                  const isToday =
                    isValid &&
                    viewYear === now.getFullYear() &&
                    viewMonth === now.getMonth() + 1 &&
                    day === now.getDate();
                  const isSelected = isValid && day === selectedDay;
                  const dayEntries = byDay.get(day) ?? [];
                  const totalIncome = dayEntries.reduce((s, e) => s + entryAmount(e).income, 0);
                  const totalExpense = dayEntries.reduce((s, e) => s + entryAmount(e).expense, 0);
                  const weekday = i % 7;
                  return (
                    <button
                      key={i}
                      disabled={!isValid}
                      onClick={() => isValid && setSelectedDay(day)}
                      className={[
                        "min-h-[4.5rem] p-1.5 border-b border-r border-slate-100 text-left transition-colors",
                        !isValid ? "bg-slate-50/50" : "hover:bg-indigo-50/50 cursor-pointer",
                        isSelected ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300" : "",
                      ].join(" ")}
                    >
                      {isValid && (
                        <>
                          <span
                            className={[
                              "inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full mb-0.5",
                              isToday
                                ? "bg-indigo-600 text-white"
                                : weekday === 0
                                  ? "text-red-500"
                                  : weekday === 6
                                    ? "text-blue-500"
                                    : "text-slate-700",
                            ].join(" ")}
                          >
                            {day}
                          </span>
                          {totalIncome > 0 && (
                            <p className="text-[10px] text-emerald-600 truncate leading-tight">
                              +{yen(totalIncome)}
                            </p>
                          )}
                          {totalExpense > 0 && (
                            <p className="text-[10px] text-rose-600 truncate leading-tight">
                              −{yen(totalExpense)}
                            </p>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* サイドパネル */}
          <div className="w-80 shrink-0 flex flex-col gap-3">
            {selectedDay ? (
              <>
                <div className="card py-2 px-4">
                  <p className="text-sm font-semibold text-slate-800">
                    {viewYear}年{viewMonth}月{selectedDay}日
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{selectedEntries.length} 件の実績</p>
                </div>

                {selectedEntries.length > 0 && (
                  <div className="card p-0 overflow-hidden">
                    <ul className="divide-y divide-slate-100">
                      {selectedEntries.map((e) => {
                        const { income, expense } = entryAmount(e);
                        const isIncome = income > 0;
                        return (
                          <li key={e.id} className="flex items-start gap-2 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">
                                {e.description}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {e.details.map((d) => displayName(d.account, sysMode)).join(" / ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`text-xs font-semibold ${isIncome ? "text-emerald-600" : "text-rose-600"}`}
                              >
                                {isIncome ? "+" : "−"}
                                {yen(isIncome ? income : expense)}
                              </span>
                              <button
                                onClick={() => handleCalDelete(e.id)}
                                className="text-slate-300 hover:text-red-400 text-xs"
                                title="削除"
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="card">
                  <h3 className="text-xs font-semibold text-slate-600 mb-3">実績を追加</h3>
                  <form onSubmit={handleCalSubmit} className="flex flex-col gap-2.5">
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                      {(["expense", "income"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() =>
                            setCalForm((f) => ({ ...f, direction: d, accountCode: "" }))
                          }
                          className={`flex-1 py-1.5 font-medium transition-colors ${
                            calForm.direction === d
                              ? d === "expense"
                                ? "bg-rose-500 text-white"
                                : "bg-emerald-500 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          {d === "expense" ? "支出" : "収入"}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">摘要</label>
                      <input
                        type="text"
                        required
                        placeholder="例: 食料品"
                        value={calForm.description}
                        onChange={(e) => setCalForm((f) => ({ ...f, description: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">
                        {calForm.direction === "expense" ? "支出科目" : "収入科目"}
                      </label>
                      <select
                        required
                        value={calForm.accountCode}
                        onChange={(e) => setCalForm((f) => ({ ...f, accountCode: e.target.value }))}
                        className="input-field text-xs"
                      >
                        <option value="">選択してください</option>
                        {calMainAccounts.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">
                        {calForm.direction === "expense" ? "支払元口座" : "入金先口座"}
                      </label>
                      <select
                        required
                        value={calForm.counterAccountCode}
                        onChange={(e) =>
                          setCalForm((f) => ({ ...f, counterAccountCode: e.target.value }))
                        }
                        className="input-field text-xs"
                      >
                        <option value="">選択してください</option>
                        {assetAccounts.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">金額（円）</label>
                      <input
                        type="number"
                        required
                        min={1}
                        placeholder="例: 5000"
                        value={calForm.amount}
                        onChange={(e) => setCalForm((f) => ({ ...f, amount: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">支払方法</label>
                      <select
                        value={calForm.paymentMethod}
                        onChange={(e) =>
                          setCalForm((f) => ({ ...f, paymentMethod: e.target.value }))
                        }
                        className="input-field text-xs"
                      >
                        {PAY_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {calError && <p className="text-xs text-red-600">{calError}</p>}
                    <button
                      type="submit"
                      disabled={calSaving}
                      className="btn-primary text-xs py-2 mt-1"
                    >
                      {calSaving ? "登録中..." : "登録"}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="card text-center py-8">
                <p className="text-sm text-slate-400">
                  カレンダーの日付をクリックして
                  <br />
                  実績を入力してください
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CSV インポートタブ ──────────────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`card cursor-pointer border-2 border-dashed transition-colors text-center py-12 ${
              dragOver
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onFileChange}
            />
            {importing ? (
              <div className="space-y-2">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-slate-500">インポート中…</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl">📂</p>
                <p className="text-sm font-medium text-slate-700">
                  クリックしてファイルを選択 または ドラッグ＆ドロップ
                </p>
                <p className="text-xs text-slate-400">CSV ファイル (.csv) に対応</p>
              </div>
            )}
          </div>
          {importResult && (
            <div
              className={`card border ${importResult.errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{importResult.errors.length === 0 ? "✅" : "⚠️"}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {importResult.inserted.toLocaleString()} 件を登録しました
                  </p>
                  {importResult.errors.length > 0 && (
                    <p className="text-xs text-amber-700">
                      {importResult.errors.length} 件のエラーがあります
                    </p>
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
              <li>
                <span className="font-medium">accountCode</span>
                ：勘定科目コード（マスタに登録済みのもの）
              </li>
              <li>
                <span className="font-medium">fiscalYear</span>：会計年度（例: {THIS_YEAR}）
              </li>
              <li>
                <span className="font-medium">month</span>：月（1〜12）
              </li>
              <li>
                <span className="font-medium">amount</span>：金額（円）
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 入力履歴（手入力タブのみ表示） ─────────────────────── */}
      {tab === "manual" && (
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
                      <td className="py-2 pr-4 text-slate-500 whitespace-nowrap text-xs font-mono">
                        {fmtDate(h.changedAt)}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLOR[h.action] ?? ""}`}
                        >
                          {ACTION_LABEL[h.action] ?? h.action}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-700">
                        <span className="font-mono text-xs text-slate-400 mr-1">
                          {h.account.code}
                        </span>
                        {displayName(h.account, sysMode)}
                      </td>
                      <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                        {h.period.fiscalYear}年 {h.period.month}月
                      </td>
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
      )}

      {/* ── マスタ管理（手入力タブのみ表示） ────────────────────── */}
      {tab === "manual" && (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
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
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                placeholder="親コード（任意）"
                value={acct.parentCode}
                onChange={(e) => setAcct({ ...acct, parentCode: e.target.value })}
                className="input-field w-28 font-mono"
              />
              <button type="submit" className="btn-primary px-3">
                追加
              </button>
            </form>
            <ul className="divide-y divide-slate-100">
              {accounts?.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2 group">
                  <span className="text-xs font-mono text-slate-400 w-14 shrink-0">{a.code}</span>
                  <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
                    {a.parent && <span className="text-xs text-slate-400 mr-1">└ </span>}
                    {a.name}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${CATEGORY_BADGE[a.category] ?? CATEGORY_BADGE.OTHER}`}
                  >
                    {CATEGORIES.find((c) => c.value === a.category)?.label}
                  </span>
                  <button
                    onClick={() => startEditAcct(a)}
                    className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="編集"
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
              <button type="submit" className="btn-primary px-3">
                追加
              </button>
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
      )}
    </AppShell>
  );
}
