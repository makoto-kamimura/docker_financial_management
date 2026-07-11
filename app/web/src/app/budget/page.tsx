"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";

type AccountRef = { id: number; code: string; name: string; category: string };
type BudgetRow = {
  id: number;
  amount: number;
  account: { id: number; code: string; name: string };
  period: { fiscalYear: number; month: number };
};
type HousingLoanOverlayRow = { accountId: number; accountCode: string; month: number; amount: number };
type BudgetResponse = { data: BudgetRow[]; years: number[]; housingLoanOverlay?: HousingLoanOverlayRow[] };
type ImportResult = { imported: number; errors: string[] };
type Tab = "manual" | "csv";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const yen = (v: number) => Math.round(v).toLocaleString("ja-JP");
const CATEGORY_ORDER = [
  "REVENUE",
  "COGS",
  "EXPENSE",
  "PROFIT",
  "OTHER",
  "ASSET",
  "LIABILITY",
] as const;

const now = new Date();
const THIS_YEAR = now.getFullYear();

function groupByAccount(
  rows: BudgetRow[],
): Map<string, { account: BudgetRow["account"]; byMonth: Map<number, BudgetRow> }> {
  const map = new Map<string, { account: BudgetRow["account"]; byMonth: Map<number, BudgetRow> }>();
  for (const r of rows) {
    if (!map.has(r.account.code))
      map.set(r.account.code, { account: r.account, byMonth: new Map() });
    map.get(r.account.code)!.byMonth.set(r.period.month, r);
  }
  return map;
}

function currentFiscalYear() {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function BudgetPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("manual");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [form, setForm] = useState({ accountCode: "", month: 1, amount: "" });
  const [editCell, setEditCell] = useState<{ id: number; amount: string } | null>(null);

  // CSV インポート
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", selectedYear],
    queryFn: async (): Promise<BudgetResponse> => {
      const url = selectedYear ? `/api/budgets?year=${selectedYear}` : "/api/budgets";
      return (await fetch(url)).json();
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const year = selectedYear ?? currentFiscalYear();
  const grouped = groupByAccount(data?.data ?? []);
  const overlayMap = new Map<string, number>();
  for (const o of data?.housingLoanOverlay ?? []) {
    overlayMap.set(`${o.accountCode}:${o.month}`, o.amount);
  }
  const overlayAccountCodes = new Set((data?.housingLoanOverlay ?? []).map((o) => o.accountCode));

  const sortedAccounts = accounts
    ? accounts
        .filter((a) => grouped.has(a.code) || overlayAccountCodes.has(a.code))
        .sort(
          (a, b) =>
            CATEGORY_ORDER.indexOf(a.category as never) -
            CATEGORY_ORDER.indexOf(b.category as never),
        )
    : Array.from(grouped.values()).map((g) => ({
        id: 0,
        code: g.account.code,
        name: g.account.name,
        category: "",
      }));

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

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/budgets/import", { method: "POST", body: fd });
      setImportResult((await res.json()) as ImportResult);
      qc.invalidateQueries({ queryKey: ["budgets"] });
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

  return (
    <AppShell>
      {/* ヘッダ */}
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
              {data?.years.map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          </div>
        )}
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
            {t === "manual" ? "明細詳細" : "CSV インポート"}
          </button>
        ))}
      </div>

      {/* ── 手入力タブ ─────────────────────────────────── */}
      {tab === "manual" && (
        <div className="card mb-6">
          <h2 className="section-title mb-4">予算を追加</h2>
          <form onSubmit={addBudget} className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 w-72">
              <label className="text-xs font-medium text-slate-600">勘定科目</label>
              <select
                value={form.accountCode}
                onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                required
                className="input-field"
              >
                <option value="">選択してください</option>
                {accounts?.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 w-24">
              <label className="text-xs font-medium text-slate-600">月</label>
              <select
                value={form.month}
                onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
                className="input-field"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 w-40">
              <label className="text-xs font-medium text-slate-600">予算金額（円）</label>
              <input
                type="number"
                placeholder="例: 350000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                className="input-field"
              />
            </div>
            <button type="submit" className="btn-primary px-5 py-2 self-end ml-auto">
              登録
            </button>
          </form>
        </div>
      )}

      {/* ── CSV インポートタブ ──────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6 mb-6">
          {/* ドロップゾーン */}
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

          {/* インポート結果 */}
          {importResult && (
            <div
              className={`card border ${importResult.errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{importResult.errors.length === 0 ? "✅" : "⚠️"}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {importResult.imported.toLocaleString()} 件をインポートしました
                  </p>
                  {importResult.errors.length > 0 && (
                    <p className="text-xs text-amber-700">
                      {importResult.errors.length} 件のエラーがあります
                    </p>
                  )}
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {importResult.errors.map((e, i) => (
                    <li key={i} className="text-xs text-amber-800 bg-amber-100 rounded px-2 py-1">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {importError && (
            <div className="card border border-red-200 bg-red-50">
              <p className="text-sm text-red-700">{importError}</p>
            </div>
          )}

          {/* フォーマットガイド */}
          <div className="card bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">CSV フォーマット</h3>
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`accountCode,fiscalYear,month,amount
H1000,${THIS_YEAR},1,400000
H2000,${THIS_YEAR},1,65000
H3000,${THIS_YEAR},1,115000`}</pre>
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
                <span className="font-medium">amount</span>：予算金額（円）
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 予算テーブル（タブ共通） ────────────────────── */}
      {isLoading && <LoadingSpinner />}

      {!isLoading && sortedAccounts.length === 0 && (
        <EmptyState
          title="予算データがありません"
          description="手入力またはCSVインポートで予算を登録してください。"
        />
      )}

      {sortedAccounts.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-44">
                    勘定科目
                  </th>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap min-w-24"
                    >
                      {m}月
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 min-w-28">
                    年間合計
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAccounts.map((acct) => {
                  const g = grouped.get(acct.code) ?? { account: undefined, byMonth: new Map() };
                  const hasOverlay = overlayAccountCodes.has(acct.code);
                  const annual = MONTHS.reduce(
                    (s, m) =>
                      s +
                      (Number(g.byMonth.get(m)?.amount) || 0) +
                      (overlayMap.get(`${acct.code}:${m}`) ?? 0),
                    0,
                  );
                  return (
                    <tr key={acct.code} className="hover:bg-slate-50 group">
                      <td className="sticky left-0 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium">
                        <span className="text-xs font-mono text-slate-400 mr-1.5">{acct.code}</span>
                        <span className="text-slate-800">{acct.name}</span>
                        {hasOverlay && (
                          <span
                            className="ml-1.5 text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded"
                            title="住宅ローンの月々の返済額が自動加算されています"
                          >
                            🏠 自動反映
                          </span>
                        )}
                      </td>
                      {MONTHS.map((m) => {
                        const cell = g.byMonth.get(m);
                        const auto = overlayMap.get(`${acct.code}:${m}`) ?? 0;
                        const isEditing = editCell && cell && editCell.id === cell.id;
                        return (
                          <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                            {isEditing ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="number"
                                  value={editCell.amount}
                                  onChange={(e) =>
                                    setEditCell({ ...editCell, amount: e.target.value })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCell();
                                    if (e.key === "Escape") setEditCell(null);
                                  }}
                                  autoFocus
                                  className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                                />
                                <button onClick={saveCell} className="text-xs text-indigo-600">
                                  ✓
                                </button>
                              </div>
                            ) : cell ? (
                              <div>
                                <div className="flex items-center justify-end gap-1 group/cell">
                                  <span>{yen(Number(cell.amount) + auto)}</span>
                                  <button
                                    onClick={() =>
                                      setEditCell({ id: cell.id, amount: String(cell.amount) })
                                    }
                                    className="text-xs text-slate-300 hover:text-indigo-500 opacity-0 group-hover/cell:opacity-100"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => deleteBudget(cell.id)}
                                    className="text-xs text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {auto > 0 && (
                                  <div className="text-[10px] text-indigo-500">内 住宅ローン {yen(auto)}</div>
                                )}
                              </div>
                            ) : auto > 0 ? (
                              <div className="text-indigo-600">
                                {yen(auto)}
                                <div className="text-[10px] text-indigo-400">住宅ローン自動反映</div>
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
