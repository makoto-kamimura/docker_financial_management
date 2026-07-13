"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AccountFlowDiagram, type FlowGraph } from "@/components/AccountFlowDiagram";

// ── 型 ──────────────────────────────────────────────────────────
type BankAccount = { id: number; name: string; bankName: string; role: string };
type CategoryAccount = { id: number; code: string; name: string; category: string };
type Txn = {
  id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  source: "MANUAL" | "CSV" | "SYNC";
  categoryAccountId: number | null;
  categoryAccount: { id: number; code: string; name: string } | null;
  postedRecordId: number | null;
};
type Transfer = {
  id: number;
  label: string | null;
  day: number;
  amount: number;
  channel: string;
  kind: string;
  note: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  fromAccount: BankAccount | null;
  toAccount: BankAccount | null;
};
type ImportResult = { inserted: number; errors: { row: number; message: string }[] };
type MonthlyCashFlowResponse = { year: number; month: number; graph: FlowGraph };
type TransferFlowResponse = {
  cyclic: boolean;
  graph: FlowGraph;
  transfers: {
    id: number;
    from: string | null;
    to: string | null;
    amount: number;
    channelLabel: string;
    label: string | null;
    day: number;
  }[];
};

// ── 定数 ────────────────────────────────────────────────────────
const now = new Date();
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const CHANNEL_LABELS: Record<string, string> = {
  INCOME: "給与・収入",
  EXPENSE: "支出",
  BANK_TRANSFER: "銀行振込",
  AUTO_DEBIT: "自動引落し",
  CARD_PAYMENT: "カード引落し",
};
const SOURCE_LABELS: Record<string, string> = { MANUAL: "手動", CSV: "CSV", SYNC: "自動取得" };

const BLANK_MANUAL = {
  date: now.toISOString().slice(0, 10),
  description: "",
  amount: "",
  balance: "",
  type: "expense" as "income" | "expense",
};
const BLANK_RECURRING = {
  label: "",
  channel: "AUTO_DEBIT" as string,
  day: 25,
  amount: "",
  note: "",
  direction: "out" as "in" | "out",
};

type Tab = "flow" | "list" | "csv" | "recurring";

// ── ページ ──────────────────────────────────────────────────────
export default function BankTransactionsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("flow");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState(BLANK_MANUAL);
  const [recurring, setRecurring] = useState(BLANK_RECURRING);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // カレンダー状態
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // フロー図タブ: 設定ベース（既定）/ 実績ベース（月次・F-6）
  const [flowSource, setFlowSource] = useState<"config" | "actual">("config");
  const [flowYear, setFlowYear] = useState(now.getFullYear());
  const [flowMonth, setFlowMonth] = useState(now.getMonth() + 1);

  // ── データ取得 ──────────────────────────────────────────────
  const { data: flowData } = useQuery({
    queryKey: ["transfer-flow"],
    enabled: tab === "flow",
    queryFn: async (): Promise<TransferFlowResponse> => {
      const res = await fetch("/api/transfers/flow");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: monthlyFlowData, isLoading: monthlyFlowLoading } = useQuery({
    queryKey: ["cashflow-monthly", flowYear, flowMonth],
    enabled: tab === "flow" && flowSource === "actual",
    queryFn: async (): Promise<MonthlyCashFlowResponse> => {
      const res = await fetch(`/api/cashflow/monthly?year=${flowYear}&month=${flowMonth}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> => {
      const list = ((await (await fetch("/api/bank-accounts")).json()).data ?? []) as BankAccount[];
      if (list.length && accountId === null) setAccountId(list[0].id);
      return list;
    },
  });

  const { data: txns } = useQuery({
    queryKey: ["bank-txns", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Txn[]> =>
      (await (await fetch(`/api/bank-accounts/${accountId}/transactions`)).json()).data ?? [],
  });

  const { data: categoryAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const categorizableAccounts = useMemo(
    () =>
      (categoryAccounts ?? []).filter((a) => ["REVENUE", "COGS", "EXPENSE"].includes(a.category)),
    [categoryAccounts],
  );

  const { data: allTransfers } = useQuery({
    queryKey: ["transfers"],
    queryFn: async (): Promise<Transfer[]> =>
      (await (await fetch("/api/transfers")).json()).data ?? [],
  });

  const transfers = useMemo(
    () =>
      (allTransfers ?? []).filter(
        (t) => t.fromAccountId === accountId || t.toAccountId === accountId,
      ),
    [allTransfers, accountId],
  );

  const transfersByDay = useMemo(() => {
    const m = new Map<number, Transfer[]>();
    for (const t of transfers) {
      if (!m.has(t.day)) m.set(t.day, []);
      m.get(t.day)!.push(t);
    }
    return m;
  }, [transfers]);

  // カレンダー計算
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const selectedDayTransfers = selectedDay ? (transfersByDay.get(selectedDay) ?? []) : [];

  // ── ハンドラ ────────────────────────────────────────────────

  async function importFile(file: File) {
    if (accountId === null) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      const json = (await res.json()) as ImportResult;
      setImportResult(json);
      if (res.ok) qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
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

  async function sync() {
    if (accountId === null) return;
    setImportResult(null);
    setImportError(null);
    const res = await fetch(`/api/bank-accounts/${accountId}/sync`, { method: "POST" });
    const json = await res.json();
    if (res.ok) {
      setImportResult({ inserted: json.fetched ?? 0, errors: [] });
      qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    } else {
      setImportError("自動取得に失敗しました。");
    }
  }

  async function deleteTxn(txnId: number) {
    await fetch(`/api/bank-accounts/${accountId}/transactions?txnId=${txnId}`, {
      method: "DELETE",
    });
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  async function setTxnCategory(txnId: number, categoryAccountId: number | null) {
    await fetch(`/api/bank-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId }),
    });
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  async function postTxnToActuals(txnId: number) {
    const res = await fetch(`/api/bank-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: true, learn: true }),
    });
    if (res.ok) {
      setMsg("実績へ転記しました。");
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`転記に失敗しました: ${err.error ?? "エラー"}`);
    }
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  async function submitManual(e: { preventDefault(): void }) {
    e.preventDefault();
    if (accountId === null) return;
    const rawAmt = Number(manual.amount);
    const amount = manual.type === "expense" ? -Math.abs(rawAmt) : Math.abs(rawAmt);
    const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: manual.date,
        description: manual.description,
        amount,
        balance: manual.balance ? Number(manual.balance) : null,
      }),
    });
    if (res.ok) {
      setManual(BLANK_MANUAL);
      setMsg("登録しました");
      qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    } else setMsg("登録に失敗しました");
  }

  async function submitRecurring(e: { preventDefault(): void }) {
    e.preventDefault();
    if (accountId === null) return;
    const body = {
      fromAccountId: recurring.direction === "out" ? accountId : null,
      toAccountId: recurring.direction === "in" ? accountId : null,
      label: recurring.label || null,
      channel: recurring.channel,
      day: recurring.day,
      amount: Number(recurring.amount),
      note: recurring.note || null,
      kind: "AUTO",
    };
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setRecurring((r) => ({ ...BLANK_RECURRING, day: r.day }));
      setMsg("追加しました");
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
    } else setMsg("追加に失敗しました");
  }

  async function deleteTransfer(id: number) {
    await fetch(`/api/transfers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["transfer-flow"] });
  }

  function prevCalMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else setViewMonth((m) => m - 1);
  }
  function nextCalMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else setViewMonth((m) => m + 1);
  }

  function selectCalDay(day: number) {
    setSelectedDay(day);
    setRecurring((r) => ({ ...r, day }));
  }

  const selectedAccount = accounts?.find((a) => a.id === accountId);
  const TABS: [Tab, string][] = [
    ["flow", "フロー図"],
    ["list", "明細一覧"],
    ["recurring", "カレンダー"],
    ["csv", "CSV インポート"],
  ];

  return (
    <AppShell>
      {/* ヘッダ */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="page-title">入出金管理</h1>
        <select
          className="input-field w-60 ml-auto"
          value={accountId ?? ""}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{a.bankName}）
            </option>
          ))}
        </select>
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setMsg(null);
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {label}
            {t === "recurring" && transfers.length > 0 && (
              <span className="ml-1.5 text-xs bg-slate-200 text-slate-600 rounded-full px-1.5">
                {transfers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mb-4 text-sm text-slate-700 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2 flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg(null)} className="text-slate-400 hover:text-slate-600 ml-4">
            ✕
          </button>
        </div>
      )}

      {/* ── フロー図タブ ─────────────────────────────────────── */}
      {tab === "flow" && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-sm h-9">
              {(["config", "actual"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFlowSource(s)}
                  className={`px-3 font-medium transition-colors ${flowSource === s ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                >
                  {s === "config" ? "設定ベース" : "実績ベース（月次）"}
                </button>
              ))}
            </div>
            {flowSource === "actual" && (
              <>
                <select
                  value={flowYear}
                  onChange={(e) => setFlowYear(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
                >
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}年
                    </option>
                  ))}
                </select>
                <select
                  value={flowMonth}
                  onChange={(e) => setFlowMonth(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
                >
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}月
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {flowSource === "config" ? (
            <div className="card mb-4">
              <h2 className="section-title mb-4">口座間 資金フロー図</h2>
              {!flowData ? (
                <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                  読み込み中…
                </div>
              ) : flowData.cyclic ? (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  循環する資金フローが検出されたため、図を表示できません。カレンダータブで設定を確認してください。
                </p>
              ) : (
                <AccountFlowDiagram data={flowData.graph} />
              )}
            </div>
          ) : (
            <div className="card mb-4">
              <h2 className="section-title mb-4">
                {flowYear}年{flowMonth}月 実績フロー図
              </h2>
              <p className="text-xs text-slate-400 mb-3">
                科目に紐付け済み（「明細一覧」タブで紐付け）の入出金明細と資金移動ルールから生成しています。
              </p>
              {monthlyFlowLoading || !monthlyFlowData ? (
                <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                  読み込み中…
                </div>
              ) : monthlyFlowData.graph.links.length === 0 ? (
                <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                  対象月に科目紐付け済みの明細がありません。「明細一覧」タブで紐付けを行ってください。
                </p>
              ) : (
                <AccountFlowDiagram data={monthlyFlowData.graph} />
              )}
            </div>
          )}

          {flowSource === "config" && flowData && flowData.transfers.length > 0 && (
            <div className="card">
              <h2 className="section-title mb-3">資金移動スケジュール</h2>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">毎月</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">移動元</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 hidden sm:table-cell">
                      →
                    </th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">移動先</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">金額</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 hidden md:table-cell">
                      方式
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flowData.transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{t.day}日</td>
                      <td className="px-3 py-2 text-slate-700">
                        {t.from ?? (
                          <span className="text-emerald-600 font-medium">
                            {t.label ?? "外部入金"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">→</td>
                      <td className="px-3 py-2 text-slate-700">
                        {t.to ?? (
                          <span className="text-rose-600 font-medium">{t.label ?? "外部支出"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                        {yen(t.amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-400 text-xs hidden md:table-cell">
                        {t.channelLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── 明細一覧タブ ─────────────────────────────────────── */}
      {tab === "list" && (
        <>
          {/* 手動登録フォーム */}
          <div className="card mb-4">
            <h2 className="section-title mb-3">入出金を手動登録</h2>
            <form onSubmit={submitManual} className="flex flex-wrap gap-3 items-end">
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-sm h-9 self-end">
                {(["expense", "income"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setManual((m) => ({ ...m, type: d }))}
                    className={`px-3 font-medium transition-colors ${manual.type === d ? (d === "expense" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  >
                    {d === "expense" ? "支出" : "収入"}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">日付</label>
                <input
                  type="date"
                  required
                  value={manual.date}
                  onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-40">
                <label className="text-xs text-slate-500">摘要</label>
                <input
                  type="text"
                  required
                  placeholder="例: 食料品"
                  value={manual.description}
                  onChange={(e) => setManual((m) => ({ ...m, description: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 w-36">
                <label className="text-xs text-slate-500">金額（円）</label>
                <input
                  type="number"
                  required
                  min={1}
                  placeholder="例: 5000"
                  value={manual.amount}
                  onChange={(e) => setManual((m) => ({ ...m, amount: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 w-36">
                <label className="text-xs text-slate-500">残高（任意）</label>
                <input
                  type="number"
                  placeholder="例: 320000"
                  value={manual.balance}
                  onChange={(e) => setManual((m) => ({ ...m, balance: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <button type="submit" className="btn-primary px-5 py-2 text-sm self-end">
                登録する
              </button>
            </form>
          </div>

          {/* 明細テーブル */}
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["日付", "摘要", "金額", "残高", "科目", "取得元", "実績", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(txns ?? []).map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                      {new Date(t.date).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-4 py-2.5">{t.description}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                    >
                      {yen(t.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                      {t.balance != null ? yen(t.balance) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={t.categoryAccountId ?? ""}
                        disabled={t.postedRecordId !== null}
                        onChange={(e) =>
                          setTxnCategory(
                            t.id,
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                        className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white disabled:bg-slate-50 disabled:text-slate-400 min-w-32"
                      >
                        <option value="">未紐付け</option>
                        {categorizableAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {SOURCE_LABELS[t.source] ?? t.source}
                    </td>
                    <td className="px-4 py-2.5">
                      {t.postedRecordId !== null ? (
                        <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">
                          転記済み
                        </span>
                      ) : (
                        <button
                          onClick={() => postTxnToActuals(t.id)}
                          disabled={t.categoryAccountId === null}
                          className="text-xs text-indigo-600 hover:text-indigo-700 disabled:text-slate-300 disabled:cursor-not-allowed"
                        >
                          転記する
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => deleteTxn(t.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-300 hover:text-red-500 transition-opacity"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                {(txns ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                      明細がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── CSV インポートタブ ───────────────────────────────── */}
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

          <div className="card flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">自動取得（同期）</p>
              <p className="text-xs text-slate-400 mt-0.5">口座と連携して最新の明細を取得します</p>
            </div>
            <button onClick={sync} className="btn-secondary px-4 py-2 text-sm whitespace-nowrap">
              同期する
            </button>
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
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`date,description,amount,balance
2026-06-25,給与振込,450000,520000
2026-06-28,家賃,-90000,430000
2026-06-30,電気代,-8500,`}</pre>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li>
                <span className="font-medium">date</span>：取引日（YYYY-MM-DD）
              </li>
              <li>
                <span className="font-medium">description</span>：摘要
              </li>
              <li>
                <span className="font-medium">amount</span>：金額（収入は正、支出は負）
              </li>
              <li>
                <span className="font-medium">balance</span>：取引後残高（任意）
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 固定の入出金タブ ─────────────────────────────────── */}
      {tab === "recurring" && (
        <div className="flex gap-4 items-start">
          {/* 左: カレンダー */}
          <div className="card flex-1 min-w-0 p-0 overflow-hidden">
            {/* 月ナビ */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <button
                onClick={prevCalMonth}
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
                onClick={nextCalMonth}
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

            {/* 曜日ヘッダ */}
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

            {/* カレンダーグリッド */}
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
                const dayTxs = isValid ? (transfersByDay.get(day) ?? []) : [];
                const weekday = i % 7;
                return (
                  <button
                    key={i}
                    disabled={!isValid}
                    onClick={() => isValid && selectCalDay(day)}
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
                        {dayTxs.slice(0, 2).map((t) => {
                          const isOut = t.fromAccountId === accountId;
                          return (
                            <p
                              key={t.id}
                              className={`text-[10px] truncate leading-tight ${isOut ? "text-rose-600" : "text-emerald-600"}`}
                            >
                              {isOut ? "−" : "+"}
                              {t.label ?? CHANNEL_LABELS[t.channel] ?? t.channel}
                            </p>
                          );
                        })}
                        {dayTxs.length > 2 && (
                          <p className="text-[9px] text-slate-400">他{dayTxs.length - 2}件</p>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右: サイドパネル */}
          <div className="w-80 shrink-0 flex flex-col gap-3">
            {selectedDay ? (
              <>
                {/* 日付ヘッダー */}
                <div className="card py-2 px-4">
                  <p className="text-sm font-semibold text-slate-800">
                    毎月{selectedDay}日 — {selectedAccount?.name ?? "この口座"}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedDayTransfers.length} 件の固定入出金
                  </p>
                </div>

                {/* その日の一覧 */}
                {selectedDayTransfers.length > 0 && (
                  <div className="card p-0 overflow-hidden">
                    <ul className="divide-y divide-slate-100">
                      {selectedDayTransfers.map((t) => {
                        const isOut = t.fromAccountId === accountId;
                        const partner = isOut ? t.toAccount : t.fromAccount;
                        return (
                          <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">
                                {t.label ?? "—"}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {CHANNEL_LABELS[t.channel] ?? t.channel}
                                {partner?.name ? " · " + partner.name : " · 外部"}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`text-xs font-semibold ${isOut ? "text-rose-600" : "text-emerald-600"}`}
                              >
                                {isOut ? "−" : "+"}
                                {yen(Number(t.amount))}
                              </span>
                              <button
                                onClick={() => deleteTransfer(t.id)}
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

                {/* 追加フォーム */}
                <div className="card">
                  <h3 className="text-xs font-semibold text-slate-600 mb-3">
                    毎月{selectedDay}日 の入出金を追加
                  </h3>
                  <form onSubmit={submitRecurring} className="flex flex-col gap-2.5">
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                      {(["out", "in"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setRecurring((r) => ({ ...r, direction: d }))}
                          className={`flex-1 py-1.5 font-medium transition-colors ${recurring.direction === d ? (d === "out" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}
                        >
                          {d === "out" ? "出金（支払）" : "入金（受取）"}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">ラベル（任意）</label>
                      <input
                        type="text"
                        placeholder="例: 家賃・給与振込"
                        value={recurring.label}
                        onChange={(e) => setRecurring((r) => ({ ...r, label: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">種別</label>
                      <select
                        value={recurring.channel}
                        onChange={(e) => setRecurring((r) => ({ ...r, channel: e.target.value }))}
                        className="input-field text-xs"
                      >
                        {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">金額（円）</label>
                      <input
                        type="number"
                        min={1}
                        required
                        placeholder="例: 90000"
                        value={recurring.amount}
                        onChange={(e) => setRecurring((r) => ({ ...r, amount: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">メモ（任意）</label>
                      <input
                        type="text"
                        placeholder="備考"
                        value={recurring.note}
                        onChange={(e) => setRecurring((r) => ({ ...r, note: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <button type="submit" className="btn-primary text-xs py-2 mt-1">
                      追加
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="card text-center py-8">
                <p className="text-sm text-slate-400">
                  カレンダーの日付をクリックして
                  <br />
                  固定の入出金を確認・追加
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
