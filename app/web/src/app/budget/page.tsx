"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pencil, Trash2, Home, CreditCard, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";
import { BudgetAllocationPanel } from "@/components/BudgetAllocationPanel";
import { useViewMode } from "@/lib/use-view-mode";
import { useMonthColumnScroll } from "@/hooks/useMonthColumnScroll";
import { displayName } from "@/lib/display-name";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { CHANGE_ACTION_LABEL as ACTION_LABEL, categoryRank } from "@/lib/labels";

type AccountRef = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};
type BudgetRow = {
  id: number;
  amount: number;
  account: { id: number; code: string; name: string };
  period: { fiscalYear: number; month: number };
};
type LoanOverlayRow = {
  accountId: number;
  accountCode: string;
  month: number;
  amount: number;
};
type PersonalAssetDebtOverlayRow = {
  accountId: number;
  accountCode: string;
  assetName: string;
  month: number;
  amount: number;
};
type BudgetResponse = {
  data: BudgetRow[];
  years: number[];
  loanOverlay?: LoanOverlayRow[];
  personalAssetDebtOverlay?: PersonalAssetDebtOverlayRow[];
};
type ImportResult = { imported: number; skipped?: number; errors: string[] };
type Tab = "manual" | "allocation" | "csv" | "history";

// 収入実績から算出した「適正金額」（予算配分ルールの割合による推奨額）
type AllocationGuideRow = { accountId: number; accountCode: string; month: number; amount: number };

// 変更履歴（実績管理の履歴と同じ形・同じ見た目で表示する）
type BudgetHistoryRow = {
  historyId: number;
  budgetId: number | null;
  action: string;
  amount: number;
  changedAt: string;
  userId: number | null;
  account: {
    id: number;
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  };
  period: { fiscalYear: number; month: number };
};
type HistorySort = "changedAt" | "account" | "amount";
const HISTORY_PAGE_SIZE = 30;
const ACTION_COLOR: Record<string, string> = {
  create: "text-green-700 bg-green-50",
  update: "text-amber-700 bg-amber-50",
  delete: "text-red-700 bg-red-50",
};
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const yen = (v: number) => Math.round(v).toLocaleString("ja-JP");

const now = new Date();
const THIS_YEAR = now.getFullYear();
const THIS_MONTH = now.getMonth() + 1;

// 「適正 ¥…」の説明（セルの title と表の注記で共用）
const GUIDE_HELP =
  "その月の収入実績に、「予算配分」タブのルールの割合を掛けた推奨額です。予算そのものは変更しません。";

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

export default function BudgetPage() {
  const qc = useQueryClient();
  const sysMode = useViewMode();
  const [tab, setTab] = useState<Tab>("manual");

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [editCell, setEditCell] = useState<{ id: number; amount: string } | null>(null);
  // セルからの新規登録（科目 × 月）と、予算がまだ無い科目の行追加
  const [addCell, setAddCell] = useState<{
    accountCode: string;
    month: number;
    amount: string;
  } | null>(null);
  const [extraAccountCodes, setExtraAccountCodes] = useState<string[]>([]);
  const [addRowCode, setAddRowCode] = useState("");

  // 履歴タブのページングとソート
  const [histOffset, setHistOffset] = useState(0);
  const [histSort, setHistSort] = useState<HistorySort>("changedAt");
  const [histOrder, setHistOrder] = useState<"asc" | "desc">("desc");

  // CSV インポート
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // 年度未選択時はサーバー既定（GET /api/budgets の暦年）と同じ当年を使う。
  // 4 月始まりで判定すると 1〜3 月に表と「適正額」「履歴」「セル登録」の年度がずれる。
  const year = selectedYear ?? THIS_YEAR;

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", year],
    queryFn: async (): Promise<BudgetResponse> => (await fetch(`/api/budgets?year=${year}`)).json(),
  });

  // 明細一覧は当月の列を左端に寄せて開く（当年以外を表示中は 1 月始まりのまま）
  const monthScrollRef = useMonthColumnScroll(year === THIS_YEAR ? THIS_MONTH : null);

  // 収入実績から算出した「適正金額」を予算表に重ねる（予算配分ルールの割合による推奨額）
  const { data: guide } = useQuery({
    queryKey: ["allocation-guide", year],
    queryFn: async (): Promise<AllocationGuideRow[]> =>
      (await (await fetch(`/api/budgets/allocation-guide?year=${year}`)).json()).data ?? [],
  });
  const guideMap = new Map((guide ?? []).map((g) => [`${g.accountCode}:${g.month}`, g.amount]));

  // 変更履歴（予算の登録・更新・削除）。タブを開いているときだけ取得する。
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ["budget-history", year, histOffset, histSort, histOrder],
    queryFn: async (): Promise<{ data: BudgetHistoryRow[]; total: number }> => {
      const res = await fetch(
        `/api/budgets/history?year=${year}&limit=${HISTORY_PAGE_SIZE}&offset=${histOffset}` +
          `&sort=${histSort}&order=${histOrder}`,
      );
      const json = await res.json();
      return { data: json.data ?? [], total: json.total ?? 0 };
    },
    enabled: tab === "history",
  });
  const histRows = history?.data ?? [];
  const histTotal = history?.total ?? 0;

  // 同じ列を押したら昇順・降順を入れ替え、別の列なら既定の向き（勘定科目は昇順、ほかは降順）から
  // 始める（実績管理の履歴と同じ挙動）
  function toggleHistorySort(next: HistorySort) {
    if (histSort === next) setHistOrder((o) => (o === "desc" ? "asc" : "desc"));
    else {
      setHistSort(next);
      setHistOrder(next === "account" ? "asc" : "desc");
    }
    setHistOffset(0);
  }

  const grouped = groupByAccount(data?.data ?? []);
  const overlayMap = new Map<string, number>();
  // 同じ科目に複数のローンが紐付くことがあるので、科目・月ごとに合算する
  for (const o of data?.loanOverlay ?? []) {
    const key = `${o.accountCode}:${o.month}`;
    overlayMap.set(key, (overlayMap.get(key) ?? 0) + o.amount);
  }
  const overlayAccountCodes = new Set((data?.loanOverlay ?? []).map((o) => o.accountCode));

  // 実物資産の負債分割（解消予定月までの月割り）分。同一科目・月に複数資産があれば合算する。
  const debtOverlayMap = new Map<string, number>();
  const debtOverlayAssetNames = new Map<string, string[]>();
  for (const o of data?.personalAssetDebtOverlay ?? []) {
    const key = `${o.accountCode}:${o.month}`;
    debtOverlayMap.set(key, (debtOverlayMap.get(key) ?? 0) + o.amount);
    const names = debtOverlayAssetNames.get(o.accountCode) ?? [];
    if (!names.includes(o.assetName)) names.push(o.assetName);
    debtOverlayAssetNames.set(o.accountCode, names);
  }
  const debtOverlayAccountCodes = new Set(
    (data?.personalAssetDebtOverlay ?? []).map((o) => o.accountCode),
  );

  const sortedAccounts = accounts
    ? accounts
        .filter(
          (a) =>
            grouped.has(a.code) ||
            overlayAccountCodes.has(a.code) ||
            debtOverlayAccountCodes.has(a.code) ||
            // 予算がまだ無い科目も「科目を追加」で行として出す
            extraAccountCodes.includes(a.code),
        )
        // 実績管理と同じカテゴリ順（lib/labels.ts の CATEGORY_ORDER）
        .sort((a, b) => categoryRank(a.category) - categoryRank(b.category))
    : Array.from(grouped.values()).map((g) => ({
        id: 0,
        code: g.account.code,
        name: g.account.name,
        category: "",
        soleName: null,
        corporateName: null,
      }));

  async function addBudgetCell() {
    if (!addCell || addCell.amount === "") return;
    await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountCode: addCell.accountCode,
        fiscalYear: year,
        month: addCell.month,
        amount: Number(addCell.amount),
      }),
    });
    setAddCell(null);
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
      if (!res.ok) {
        setImportError(await importErrorMessage(res));
        return;
      }
      setImportResult((await res.json()) as ImportResult);
      qc.invalidateQueries({ queryKey: ["budgets"] });
    } catch {
      setImportError(importNetworkErrorMessage);
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

  // 予算がまだ無い科目を行として足すバー（表の下・空表示の両方で使う）
  const addAccountRowBar = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <label className="text-xs font-medium text-slate-600">科目を追加</label>
      <select
        value={addRowCode}
        onChange={(e) => setAddRowCode(e.target.value)}
        className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-64"
      >
        <option value="">選択してください</option>
        {(accounts ?? [])
          .filter((a) => !sortedAccounts.some((x) => x.code === a.code))
          .map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} {displayName(a, sysMode)}
            </option>
          ))}
      </select>
      <button
        type="button"
        disabled={addRowCode === ""}
        onClick={() => {
          setExtraAccountCodes((codes) =>
            codes.includes(addRowCode) ? codes : [...codes, addRowCode],
          );
          setAddRowCode("");
        }}
        className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
      >
        行を追加
      </button>
      <p className="text-[11px] text-slate-400 ml-auto">
        セルの「—」をクリックすると、その科目・月の予算を登録できます。
      </p>
    </div>
  );

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
              onChange={(e) => {
                setSelectedYear(Number(e.target.value));
                setHistOffset(0); // 年度を切り替えたら履歴も 1 ページ目に戻す
              }}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {/* 表示中の年度に期間がまだ無いときも選択肢に含める */}
              {[...new Set([...(data?.years ?? []), year])]
                .sort((a, b) => a - b)
                .map((y) => (
                  <option key={y} value={y}>
                    {y}年度
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* タブ切り替え（予算配分は明細一覧の右、履歴は実績管理の履歴と同じ末尾に置く） */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {(
          [
            ["manual", "明細一覧"],
            ["allocation", "予算配分"],
            ["csv", "CSV インポート"],
            ["history", "履歴"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 予算の追加は下の表のセル（「—」をクリック）から行う。旧「予算を追加」フォームは廃止した。 */}

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
                  {(importResult.skipped ?? 0) > 0 && (
                    <p className="text-xs text-slate-600">
                      {importResult.skipped!.toLocaleString()}{" "}
                      件は既に同じ金額で登録済みのためスキップしました
                    </p>
                  )}
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

      {/* ── 予算配分タブ（旧「設定 › 予算配分ルール」から移設）────────────
          ルールの割合は明細一覧の「適正 ¥…」にも反映される。 */}
      {tab === "allocation" && <BudgetAllocationPanel fiscalYear={year} />}

      {/* ── 履歴タブ（実績管理の履歴と同じ見た目）──────────── */}
      {tab === "history" &&
        (histLoading ? (
          <LoadingSpinner label="履歴を読み込み中…" />
        ) : histRows.length === 0 ? (
          <p className="text-sm text-slate-400">まだ{year}年度の履歴はありません。</p>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-2">
              全 {histTotal.toLocaleString()} 件中 {histOffset + 1}〜
              {Math.min(histOffset + HISTORY_PAGE_SIZE, histTotal)} 件を表示
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2 pr-4 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleHistorySort("changedAt")}
                        className={`inline-flex items-center gap-1 hover:text-slate-700 ${
                          histSort === "changedAt" ? "text-indigo-700 font-semibold" : ""
                        }`}
                      >
                        日時
                        <span className="text-[10px]">
                          {histSort === "changedAt" ? (histOrder === "desc" ? "▼" : "▲") : "↕"}
                        </span>
                      </button>
                    </th>
                    <th className="text-left py-2 pr-4 font-medium">操作</th>
                    <th className="text-left py-2 pr-4 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleHistorySort("account")}
                        className={`inline-flex items-center gap-1 hover:text-slate-700 ${
                          histSort === "account" ? "text-indigo-700 font-semibold" : ""
                        }`}
                      >
                        勘定科目
                        <span className="text-[10px]">
                          {histSort === "account" ? (histOrder === "desc" ? "▼" : "▲") : "↕"}
                        </span>
                      </button>
                    </th>
                    <th className="text-left py-2 pr-4 font-medium">期間</th>
                    <th className="text-right py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleHistorySort("amount")}
                        className={`inline-flex items-center gap-1 hover:text-slate-700 ${
                          histSort === "amount" ? "text-indigo-700 font-semibold" : ""
                        }`}
                      >
                        金額
                        <span className="text-[10px]">
                          {histSort === "amount" ? (histOrder === "desc" ? "▼" : "▲") : "↕"}
                        </span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {histRows.map((h) => (
                    <tr key={h.historyId} className="hover:bg-slate-50">
                      <td className="py-2 pr-4 text-slate-500 whitespace-nowrap text-xs font-mono">
                        {fmtDateTime(h.changedAt)}
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
                      <td className="py-2 text-right font-mono text-slate-800">¥{yen(h.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-3 pt-3 mt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setHistOffset(Math.max(0, histOffset - HISTORY_PAGE_SIZE))}
                  disabled={histOffset === 0}
                  className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  ← 前の {HISTORY_PAGE_SIZE} 件
                </button>
                <span className="text-xs text-slate-400">
                  {Math.floor(histOffset / HISTORY_PAGE_SIZE) + 1} /{" "}
                  {Math.max(1, Math.ceil(histTotal / HISTORY_PAGE_SIZE))} ページ
                </span>
                <button
                  type="button"
                  onClick={() => setHistOffset(histOffset + HISTORY_PAGE_SIZE)}
                  disabled={histOffset + HISTORY_PAGE_SIZE >= histTotal}
                  className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  次の {HISTORY_PAGE_SIZE} 件 →
                </button>
              </div>
            </div>
          </>
        ))}

      {/* 配分提案（収入からの推奨配分）は上の「予算配分」タブに集約した。
          ここでは下の表に「適正 ¥…」として推奨額を重ねて表示する。 */}

      {/* ── 予算テーブル（明細一覧タブのみ。CSV インポートタブでは出さない）── */}
      {tab === "manual" && isLoading && <LoadingSpinner />}

      {tab === "manual" && !isLoading && sortedAccounts.length === 0 && (
        <>
          <EmptyState
            title="予算データがありません"
            description="「科目を追加」で科目を選ぶと、月ごとに予算を入力できます（CSV インポートでも登録できます）。"
          />
          <div className="card mt-4">{addAccountRowBar}</div>
        </>
      )}

      {tab === "manual" && sortedAccounts.length > 0 && (
        <div className="card overflow-hidden p-0">
          {(guide ?? []).length > 0 && (
            <p className="px-4 pt-3 text-xs text-emerald-700">
              緑の「適正 ¥…」は{GUIDE_HELP.replace("その月の", "")}
              割合の変更は
              <button
                type="button"
                onClick={() => setTab("allocation")}
                className="underline underline-offset-2 mx-1 hover:text-emerald-800"
              >
                「予算配分」タブ
              </button>
              から行えます。
            </p>
          )}
          <div ref={monthScrollRef} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-44">
                    勘定科目
                  </th>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      data-month={m}
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
                  const hasDebtOverlay = debtOverlayAccountCodes.has(acct.code);
                  const annual = MONTHS.reduce(
                    (s, m) =>
                      s +
                      (Number(g.byMonth.get(m)?.amount) || 0) +
                      (overlayMap.get(`${acct.code}:${m}`) ?? 0) +
                      (debtOverlayMap.get(`${acct.code}:${m}`) ?? 0),
                    0,
                  );
                  return (
                    <tr key={acct.code} className="hover:bg-slate-50 group">
                      <td className="sticky left-0 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium">
                        <span className="text-xs font-mono text-slate-400 mr-1.5">{acct.code}</span>
                        <span className="text-slate-800">{displayName(acct, sysMode)}</span>
                        {hasOverlay && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded"
                            title="ローンの月々の返済額が自動加算されています"
                          >
                            <Home className="w-3 h-3" aria-hidden="true" />
                            自動反映
                          </span>
                        )}
                        {hasDebtOverlay && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded"
                            title={`実物資産（${(debtOverlayAssetNames.get(acct.code) ?? []).join("・")}）の負債残高を解消予定月まで月割りして自動加算しています`}
                          >
                            <CreditCard className="w-3 h-3" aria-hidden="true" />
                            返済分
                          </span>
                        )}
                      </td>
                      {MONTHS.map((m) => {
                        const cell = g.byMonth.get(m);
                        const auto = overlayMap.get(`${acct.code}:${m}`) ?? 0;
                        const debtAuto = debtOverlayMap.get(`${acct.code}:${m}`) ?? 0;
                        // 収入実績から算出した推奨額（予算配分ルール）。補助表示のみ。
                        const guideAmount = guideMap.get(`${acct.code}:${m}`) ?? 0;
                        const isEditing = editCell && cell && editCell.id === cell.id;
                        const isAdding =
                          addCell !== null &&
                          addCell.accountCode === acct.code &&
                          addCell.month === m;
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
                                <button
                                  type="button"
                                  aria-label="保存"
                                  title="保存"
                                  onClick={saveCell}
                                  className="text-indigo-600 hover:text-indigo-700"
                                >
                                  <Check className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                            ) : cell ? (
                              <div>
                                <div className="flex items-center justify-end gap-1 group/cell">
                                  <span>{yen(Number(cell.amount) + auto + debtAuto)}</span>
                                  <button
                                    type="button"
                                    aria-label="この予算を編集"
                                    title="編集"
                                    onClick={() =>
                                      setEditCell({ id: cell.id, amount: String(cell.amount) })
                                    }
                                    className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover/cell:opacity-100"
                                  >
                                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="この予算を削除"
                                    title="削除"
                                    onClick={() => deleteBudget(cell.id)}
                                    className="text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                                {auto > 0 && (
                                  <div className="text-[10px] text-indigo-500">
                                    内 ローン返済 {yen(auto)}
                                  </div>
                                )}
                                {debtAuto > 0 && (
                                  <div className="text-[10px] text-amber-600">
                                    内 負債返済分 {yen(debtAuto)}
                                  </div>
                                )}
                                {guideAmount > 0 && (
                                  <div className="text-[10px] text-emerald-600" title={GUIDE_HELP}>
                                    適正 {yen(guideAmount)}
                                  </div>
                                )}
                              </div>
                            ) : auto > 0 || debtAuto > 0 ? (
                              <div>
                                {auto > 0 && (
                                  <div className="text-indigo-600">
                                    {yen(auto)}
                                    <div className="text-[10px] text-indigo-400">
                                      ローン返済自動反映
                                    </div>
                                  </div>
                                )}
                                {debtAuto > 0 && (
                                  <div className="text-amber-600">
                                    {yen(debtAuto)}
                                    <div className="text-[10px] text-amber-500">
                                      負債返済分自動反映
                                    </div>
                                  </div>
                                )}
                                {guideAmount > 0 && (
                                  <div className="text-[10px] text-emerald-600" title={GUIDE_HELP}>
                                    適正 {yen(guideAmount)}
                                  </div>
                                )}
                              </div>
                            ) : isAdding ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="number"
                                  value={addCell.amount}
                                  placeholder="金額"
                                  onChange={(e) =>
                                    setAddCell({ ...addCell, amount: e.target.value })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") addBudgetCell();
                                    if (e.key === "Escape") setAddCell(null);
                                  }}
                                  autoFocus
                                  className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                                />
                                <button
                                  type="button"
                                  aria-label="登録"
                                  title="登録"
                                  onClick={addBudgetCell}
                                  className="text-indigo-600 hover:text-indigo-700"
                                >
                                  <Check className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setAddCell({ accountCode: acct.code, month: m, amount: "" })
                                }
                                title={`${acct.code} の ${m}月に予算を追加`}
                                className="text-slate-300 hover:text-indigo-500"
                              >
                                {guideAmount > 0 ? (
                                  <span className="text-[10px] text-emerald-600">
                                    適正 {yen(guideAmount)}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </button>
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
          <div className="border-t border-slate-100">{addAccountRowBar}</div>
        </div>
      )}
    </AppShell>
  );
}
