"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useMemo } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { useViewMode } from "@/lib/use-view-mode";
import { useMonthColumnScroll } from "@/hooks/useMonthColumnScroll";
import { displayName } from "@/lib/display-name";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import {
  buildFinancialMatrix,
  editableRecord,
  MATRIX_MONTHS,
  type MatrixRecord,
} from "@/lib/financial-matrix";
import {
  CATEGORY_LABEL as GROUP_LABELS,
  CATEGORY_ORDER as GROUP_ORDER,
  CHANGE_ACTION_LABEL as ACTION_LABEL,
  categoryRank,
} from "@/lib/labels";

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
type ImportResult = {
  inserted: number;
  /** すでに同じ内容が登録済みでスキップした行数 */
  skipped?: number;
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
    id: number;
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  };
  period: { fiscalYear: number; month: number };
};

// 履歴のページングとソート
const HISTORY_PAGE_SIZE = 30;
type HistorySort = "changedAt" | "account" | "amount";
type HistoryResponse = { data: RecentHistory[]; total: number };

// 実績 1 行の出どころ（GET /api/financials/matrix）。セルの内訳モーダルで表示する
type RecordSource = {
  kind: "bank" | "card" | "journal" | "direct";
  date: string | null;
  description: string | null;
  accountName: string | null;
};
type MatrixEntry = MatrixRecord & {
  journalEntryId: number | null;
  createdAt: string;
  source: RecordSource;
};
type MatrixResponse = {
  year: number;
  data: MatrixEntry[];
  years: number[];
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
const ACTION_COLOR: Record<string, string> = {
  create: "text-green-700 bg-green-50",
  update: "text-amber-700 bg-amber-50",
  delete: "text-red-700 bg-red-50",
};

const CATEGORY_BADGE: Record<string, string> = {
  REVENUE: "bg-blue-50 text-blue-700",
  COGS: "bg-orange-50 text-orange-700",
  EXPENSE: "bg-amber-50 text-amber-700",
  PROFIT: "bg-green-50 text-green-700",
  ASSET: "bg-emerald-50 text-emerald-700",
  LIABILITY: "bg-rose-50 text-rose-700",
  OTHER: "bg-slate-100 text-slate-600",
};

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

// セル内訳モーダルに出す「どこから入った実績か」のラベル
const SOURCE_LABEL: Record<RecordSource["kind"], string> = {
  bank: "銀行明細から転記",
  card: "カード明細から転記",
  journal: "仕訳と連動",
  direct: "手入力・CSV 取込",
};
const SOURCE_BADGE: Record<RecordSource["kind"], string> = {
  bank: "bg-sky-50 text-sky-700",
  card: "bg-violet-50 text-violet-700",
  journal: "bg-amber-50 text-amber-700",
  direct: "bg-slate-100 text-slate-600",
};
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

type Tab = "manual" | "calendar" | "csv" | "history";

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

  const [histOffset, setHistOffset] = useState(0);
  const [histSort, setHistSort] = useState<HistorySort>("changedAt");
  const [histOrder, setHistOrder] = useState<"asc" | "desc">("desc");

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ["recent-history", histOffset, histSort, histOrder],
    queryFn: async (): Promise<HistoryResponse> => {
      const res = await fetch(
        `/api/financials/recent?limit=${HISTORY_PAGE_SIZE}&offset=${histOffset}` +
          `&sort=${histSort}&order=${histOrder}`,
      );
      const json = await res.json();
      return { data: json.data ?? [], total: json.total ?? 0 };
    },
    // 履歴タブを開いているときだけ取得・更新する
    enabled: tab === "history",
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const recentHistory = history?.data;
  const histTotal = history?.total ?? 0;

  const [matrixYear, setMatrixYear] = useState<number | null>(null);
  const [matrixEdit, setMatrixEdit] = useState<{ id: number; amount: string } | null>(null);
  const [matrixAdd, setMatrixAdd] = useState<{
    accountCode: string;
    month: number;
    amount: string;
  } | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  // 「◯件」を押して開くセル内訳モーダル（同じ科目・月に複数の実績があるセル）
  const [cellDetail, setCellDetail] = useState<{ accountCode: string; month: number } | null>(null);
  // 内訳モーダル内での金額編集（テーブル本体の matrixEdit とは独立させる）
  const [detailEdit, setDetailEdit] = useState<{ id: number; amount: string } | null>(null);

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: ["financials-matrix", matrixYear],
    enabled: tab === "manual",
    queryFn: async (): Promise<MatrixResponse> => {
      const url = matrixYear
        ? `/api/financials/matrix?year=${matrixYear}`
        : "/api/financials/matrix";
      return (await fetch(url)).json();
    },
    placeholderData: (prev) => prev,
  });
  const matrixCurrentYear = matrixData?.year ?? matrixYear ?? THIS_YEAR;

  // 明細一覧は当月の列を左端に寄せて開く（当年以外を表示中は 1 月始まりのまま）
  const monthScrollRef = useMonthColumnScroll(matrixCurrentYear === THIS_YEAR ? THIS_MONTH : null);

  // 科目 × 月へ組み替え、予算管理と同じカテゴリ順（資産→負債→収入→…）で並べる
  const matrixRows = useMemo(() => {
    const rows = buildFinancialMatrix(matrixData?.data ?? []);
    return rows.sort(
      (a, b) =>
        categoryRank(a.account.category) - categoryRank(b.account.category) ||
        a.account.code.localeCompare(b.account.code),
    );
  }, [matrixData]);

  // 内訳モーダルの対象セル。削除で 0 件になったセルは detailCell が null になる
  const detailCell = useMemo(() => {
    if (!cellDetail) return null;
    const row = matrixRows.find((r) => r.account.code === cellDetail.accountCode);
    return row?.byMonth.get(cellDetail.month) ?? null;
  }, [cellDetail, matrixRows]);
  const detailAccount = cellDetail
    ? (matrixRows.find((r) => r.account.code === cellDetail.accountCode)?.account ?? null)
    : null;

  // ソート列見出しのクリック: 同じ列なら昇順/降順を反転、別の列なら既定の向きから
  function toggleHistorySort(key: HistorySort) {
    if (key === histSort) {
      setHistOrder(histOrder === "desc" ? "asc" : "desc");
    } else {
      setHistSort(key);
      setHistOrder(key === "account" ? "asc" : "desc");
    }
    setHistOffset(0);
  }

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

  // 参照が毎回変わると下の useMemo が無駄に再計算されるため、ここで安定させる
  const calEntries = useMemo(() => journalData?.data ?? [], [journalData]);

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

  // 表示中の月に入力された実績の合計（カレンダー上部に表示する）
  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of calEntries) {
      const a = entryAmount(e);
      income += a.income;
      expense += a.expense;
    }
    return { income, expense, net: income - expense, count: calEntries.length };
  }, [calEntries]);

  const incomeAccounts = (accounts ?? []).filter((a) => INCOME_CATS.includes(a.category));
  const expenseAccounts = (accounts ?? []).filter((a) => EXPENSE_CATS.includes(a.category));
  const assetAccounts = (accounts ?? []).filter((a) => ASSET_CATS.includes(a.category));
  const calMainAccounts = calForm.direction === "income" ? incomeAccounts : expenseAccounts;

  const byCategory = (accounts ?? []).reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  // 履歴の勘定科目インライン編集。転記元の銀行/カード明細がある場合はサーバ側で
  // categoryAccountId も追随して更新される（PATCH /api/financials/[id]）。
  const [historyAcctError, setHistoryAcctError] = useState<Record<number, string>>({});
  async function updateHistoryAccount(recordId: number, accountId: number) {
    setHistoryAcctError((m) => ({ ...m, [recordId]: "" }));
    const res = await fetch(`/api/financials/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["recent-history"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setHistoryAcctError((m) => ({
        ...m,
        [recordId]: err.error ?? "勘定科目の変更に失敗しました。",
      }));
    }
  }

  // ── テーブル表示モード（勘定科目 × 月）のハンドラ ───────────────
  function invalidateRecords() {
    queryClient.invalidateQueries({ queryKey: ["financials-matrix"] });
    queryClient.invalidateQueries({ queryKey: ["recent-history"] });
  }

  // 実績 1 行の金額更新。テーブルのセル編集とセル内訳モーダルの両方から使う
  async function updateRecordAmount(id: number, amount: number): Promise<boolean> {
    setMatrixError(null);
    const res = await fetch(`/api/financials/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      invalidateRecords();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    setMatrixError(err.error ?? "更新に失敗しました。");
    return false;
  }

  async function saveMatrixCell() {
    if (!matrixEdit) return;
    if (await updateRecordAmount(matrixEdit.id, Number(matrixEdit.amount))) setMatrixEdit(null);
  }

  // 内訳モーダルからの更新・削除。削除は取り消せないので確認を挟む
  async function saveDetailAmount() {
    if (!detailEdit) return;
    if (await updateRecordAmount(detailEdit.id, Number(detailEdit.amount))) setDetailEdit(null);
  }

  async function deleteDetailRecord(r: MatrixEntry) {
    if (!confirm(`${yen(Number(r.amount))} の実績を削除します。よろしいですか？`)) return;
    if (detailEdit?.id === r.id) setDetailEdit(null);
    await deleteMatrixCell(r.id);
  }

  async function deleteMatrixCell(id: number) {
    setMatrixError(null);
    const res = await fetch(`/api/financials/${id}`, { method: "DELETE" });
    if (res.ok) invalidateRecords();
    else setMatrixError("削除に失敗しました。");
  }

  async function addMatrixCell() {
    if (!matrixAdd || matrixAdd.amount === "") return;
    setMatrixError(null);
    const res = await fetch("/api/financials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountCode: matrixAdd.accountCode,
        fiscalYear: matrixCurrentYear,
        month: matrixAdd.month,
        amount: Number(matrixAdd.amount),
      }),
    });
    if (res.ok) {
      setMatrixAdd(null);
      invalidateRecords();
    } else {
      const err = await res.json().catch(() => ({}));
      setMatrixError(err.error ?? "登録に失敗しました。");
    }
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
      if (!res.ok) {
        setImportError(await importErrorMessage(res));
        return;
      }
      setImportResult((await res.json()) as ImportResult);
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

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-title">実績管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">月次の財務実績を登録します</p>
        </div>
        {/* 年度は予算管理と同じくページ上部に置く（科目×月テーブルの対象年度） */}
        {tab === "manual" && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">年度</label>
            <select
              value={matrixCurrentYear}
              onChange={(e) => {
                setMatrixYear(Number(e.target.value));
                setMatrixEdit(null);
                setMatrixAdd(null);
              }}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(matrixData?.years?.length ? matrixData.years : [matrixCurrentYear]).map((y) => (
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
        {(
          [
            ["manual", "明細一覧"],
            ["calendar", "カレンダー"],
            ["csv", "CSV インポート"],
            ["history", "履歴"],
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

      {/* 実績の新規登録は下の「科目×月テーブル」のセルから行う（旧「新規登録」フォームは廃止）。
          科目名の変更は「設定 › 科目名設定」に集約した。 */}

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
            {/* 当月に入力された実績の合計 */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
              <span className="text-xs text-slate-500">
                収入合計{" "}
                <span className="text-sm font-semibold text-emerald-600 tabular-nums">
                  {yen(monthTotals.income)}
                </span>
              </span>
              <span className="text-xs text-slate-500">
                支出合計{" "}
                <span className="text-sm font-semibold text-rose-600 tabular-nums">
                  {yen(monthTotals.expense)}
                </span>
              </span>
              <span className="text-xs text-slate-500">
                差引{" "}
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    monthTotals.net < 0 ? "text-red-600" : "text-indigo-600"
                  }`}
                >
                  {yen(monthTotals.net)}
                </span>
              </span>
              <span className="text-xs text-slate-400 ml-auto">{monthTotals.count} 件の実績</span>
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
                  {selectedEntries.length > 0 &&
                    (() => {
                      const income = selectedEntries.reduce((s, e) => s + entryAmount(e).income, 0);
                      const expense = selectedEntries.reduce(
                        (s, e) => s + entryAmount(e).expense,
                        0,
                      );
                      return (
                        <p className="text-xs text-slate-500 mt-1">
                          {income > 0 && (
                            <span className="text-emerald-600 font-medium mr-3">
                              収入 {yen(income)}
                            </span>
                          )}
                          {expense > 0 && (
                            <span className="text-rose-600 font-medium">支出 {yen(expense)}</span>
                          )}
                        </p>
                      );
                    })()}
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
                  {(importResult.skipped ?? 0) > 0 && (
                    <p className="text-xs text-slate-600">
                      {importResult.skipped!.toLocaleString()}{" "}
                      件は既に同じ内容（科目・年月・金額）が登録済みのためスキップしました
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

          {/* 給与明細の項目は、下の科目コードを使ってこの CSV から登録する
              （旧「給与明細 CSV の取込」は廃止し、科目マスタ側に項目を用意した） */}
          <div className="card bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              給与明細の内容を登録する場合の科目コード
            </h3>
            <p className="text-xs text-slate-500 mb-2">
              給与明細（マネーフォワード等）の各項目は、次の科目コードで上の CSV
              から登録できます。内訳をまとめたい場合は「社会保険（H-3009）」に合算してください。
            </p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-200">
                {[
                  ["総支給額・基本給", "H-1001 給与"],
                  ["賞与", "H-1002 賞与"],
                  ["通勤手当", "H-1017 通勤手当"],
                  ["残業手当", "H-1018 残業手当"],
                  ["住宅手当・家族手当", "H-1019 住宅手当・家族手当"],
                  ["健康保険料", "H-3035 健康保険料"],
                  ["介護保険料", "H-3036 介護保険料"],
                  ["厚生年金保険料", "H-3037 厚生年金保険料"],
                  ["雇用保険料", "H-3038 雇用保険料"],
                  ["社会保険（内訳をまとめる場合）", "H-3009 社会保険"],
                  ["所得税", "H-3030 所得税"],
                  ["住民税", "H-3014 住民税"],
                ].map(([item, code]) => (
                  <tr key={item}>
                    <td className="py-1 pr-3 text-slate-600">{item}</td>
                    <td className="py-1 font-mono text-slate-700">{code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 実績一覧（明細一覧タブ = 科目×月テーブル / 履歴タブ = 変更履歴）── */}
      {(tab === "manual" || tab === "history") && (
        <div>
          {tab === "history" && histTotal > 0 && (
            <p className="text-xs text-slate-500 mb-3">
              全 {histTotal} 件中 {histOffset + 1}〜
              {Math.min(histOffset + HISTORY_PAGE_SIZE, histTotal)} 件を表示
            </p>
          )}

          {/* ── 科目×月テーブル（明細一覧タブ）───────────────────── */}
          {tab === "manual" && (
            <>
              {matrixError && (
                <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {matrixError}
                </p>
              )}
              {matrixLoading && !matrixData ? (
                <LoadingSpinner label="実績を読み込み中…" />
              ) : matrixRows.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {matrixCurrentYear}
                  年度の実績がありません。CSV インポートまたはカレンダーから登録してください。
                </p>
              ) : (
                <div className="card overflow-hidden p-0">
                  <div ref={monthScrollRef} className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-44">
                            勘定科目
                          </th>
                          {MATRIX_MONTHS.map((m) => (
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
                        {matrixRows.map((row) => (
                          <tr key={row.account.code} className="hover:bg-slate-50 group">
                            <td className="sticky left-0 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium">
                              <span className="text-xs font-mono text-slate-400 mr-1.5">
                                {row.account.code}
                              </span>
                              <span className="text-slate-800">
                                {displayName(
                                  accounts?.find((a) => a.code === row.account.code) ?? row.account,
                                  sysMode,
                                )}
                              </span>
                              <span
                                className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[row.account.category] ?? ""}`}
                              >
                                {GROUP_LABELS[row.account.category] ?? row.account.category}
                              </span>
                            </td>
                            {MATRIX_MONTHS.map((m) => {
                              const cell = row.byMonth.get(m);
                              const single = editableRecord(cell);
                              const editing =
                                single && matrixEdit?.id === single.id ? matrixEdit : null;
                              const adding =
                                matrixAdd &&
                                matrixAdd.accountCode === row.account.code &&
                                matrixAdd.month === m
                                  ? matrixAdd
                                  : null;
                              return (
                                <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                                  {editing ? (
                                    <div className="flex items-center gap-1 justify-end">
                                      <input
                                        type="number"
                                        value={editing.amount}
                                        onChange={(e) =>
                                          setMatrixEdit({ ...editing, amount: e.target.value })
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") saveMatrixCell();
                                          if (e.key === "Escape") setMatrixEdit(null);
                                        }}
                                        autoFocus
                                        className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                                      />
                                      <button
                                        type="button"
                                        aria-label="保存"
                                        title="保存"
                                        onClick={saveMatrixCell}
                                        className="text-indigo-600 hover:text-indigo-700"
                                      >
                                        <Check className="w-4 h-4" aria-hidden="true" />
                                      </button>
                                    </div>
                                  ) : adding ? (
                                    <div className="flex items-center gap-1 justify-end">
                                      <input
                                        type="number"
                                        value={adding.amount}
                                        placeholder="金額"
                                        onChange={(e) =>
                                          setMatrixAdd({ ...adding, amount: e.target.value })
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") addMatrixCell();
                                          if (e.key === "Escape") setMatrixAdd(null);
                                        }}
                                        autoFocus
                                        className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                                      />
                                      <button
                                        type="button"
                                        aria-label="登録"
                                        title="登録"
                                        onClick={addMatrixCell}
                                        className="text-indigo-600 hover:text-indigo-700"
                                      >
                                        <Check className="w-4 h-4" aria-hidden="true" />
                                      </button>
                                    </div>
                                  ) : cell ? (
                                    <div className="flex items-center justify-end gap-1 group/cell">
                                      <span>{cell.total.toLocaleString("ja-JP")}</span>
                                      {cell.records.length > 1 ? (
                                        // 複数件のセルはその場で編集できないため、内訳モーダルで
                                        // 1 行ずつ内容を確認して編集・削除する
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setCellDetail({
                                              accountCode: row.account.code,
                                              month: m,
                                            })
                                          }
                                          title="この月の実績の内訳を表示"
                                          className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2 whitespace-nowrap"
                                        >
                                          {cell.records.length}件
                                        </button>
                                      ) : single && single.journalEntryId !== null ? (
                                        <span
                                          className="text-[10px] text-slate-400"
                                          title="仕訳と連動した実績のため、金額は仕訳帳から修正してください。"
                                        >
                                          仕訳
                                        </span>
                                      ) : (
                                        single && (
                                          <>
                                            <button
                                              type="button"
                                              aria-label="この実績を編集"
                                              title="編集"
                                              onClick={() =>
                                                setMatrixEdit({
                                                  id: single.id,
                                                  amount: String(single.amount),
                                                })
                                              }
                                              className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover/cell:opacity-100"
                                            >
                                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                            <button
                                              type="button"
                                              aria-label="この実績を削除"
                                              title="削除"
                                              onClick={() => deleteMatrixCell(single.id)}
                                              className="text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                          </>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setMatrixAdd({
                                          accountCode: row.account.code,
                                          month: m,
                                          amount: "",
                                        })
                                      }
                                      className="text-slate-300 hover:text-indigo-500"
                                      title={`${row.account.code} の ${m}月に実績を追加`}
                                    >
                                      —
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">
                              {row.annual.toLocaleString("ja-JP")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── 履歴（履歴タブ）─────────────────────────── */}
          {tab === "history" &&
            (histLoading ? (
              <LoadingSpinner label="履歴を読み込み中…" />
            ) : recentHistory && recentHistory.length > 0 ? (
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
                          {h.action === "delete" ? (
                            <>
                              <span className="font-mono text-xs text-slate-400 mr-1">
                                {h.account.code}
                              </span>
                              {displayName(h.account, sysMode)}
                            </>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <select
                                value={h.account.id}
                                onChange={(e) =>
                                  updateHistoryAccount(h.recordId, Number(e.target.value))
                                }
                                className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-40"
                              >
                                {GROUP_ORDER.map((cat) => {
                                  const items = byCategory[cat] ?? [];
                                  if (items.length === 0) return null;
                                  return (
                                    <optgroup key={cat} label={GROUP_LABELS[cat]}>
                                      {items.map((a) => (
                                        <option key={a.id} value={a.id}>
                                          {a.code} {displayName(a, sysMode)}
                                        </option>
                                      ))}
                                    </optgroup>
                                  );
                                })}
                              </select>
                              {historyAcctError[h.recordId] && (
                                <span className="text-[10px] text-red-500">
                                  {historyAcctError[h.recordId]}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                          {h.period.fiscalYear}年 {h.period.month}月
                        </td>
                        <td className="py-2 text-right font-mono text-slate-800">
                          {yen(h.amount)}
                        </td>
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
            ) : (
              <p className="text-sm text-slate-400">まだ履歴はありません。</p>
            ))}
        </div>
      )}

      {/* ── セル内訳モーダル（「◯件」を押したとき）─────────────────
          同じ科目・月に複数の実績があるセルは合計しか出せないため、
          1 件ずつの金額・登録日時・出どころをここで確認し、編集・削除もできるようにする。 */}
      {cellDetail && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl my-auto">
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="text-lg font-bold text-slate-800">
                {detailAccount
                  ? displayName(
                      accounts?.find((a) => a.code === detailAccount.code) ?? detailAccount,
                      sysMode,
                    )
                  : "実績の内訳"}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {matrixCurrentYear}年{cellDetail.month}月
                </span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  setCellDetail(null);
                  setDetailEdit(null);
                }}
                className="text-sm text-slate-400 hover:text-slate-600"
              >
                閉じる
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              このセルに登録されている実績の一覧です。合計 {yen(detailCell?.total ?? 0)}（
              {detailCell?.records.length ?? 0} 件）
            </p>

            {matrixError && <p className="text-xs text-red-600 mb-2">{matrixError}</p>}

            {detailCell && detailCell.records.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2 pr-4 font-medium">登録日時</th>
                      <th className="text-left py-2 pr-4 font-medium">出どころ</th>
                      <th className="text-left py-2 pr-4 font-medium">内容</th>
                      <th className="text-right py-2 pr-2 font-medium">金額</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailCell.records.map((r) => {
                      const editing = detailEdit?.id === r.id ? detailEdit : null;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="py-2 pr-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                            {fmtDate(r.createdAt)}
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_BADGE[r.source.kind]}`}
                            >
                              {SOURCE_LABEL[r.source.kind]}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-xs text-slate-600">
                            {r.source.description ? (
                              <>
                                {r.source.date &&
                                  `${new Date(r.source.date).toLocaleDateString("ja-JP")} · `}
                                {r.source.description}
                                {r.source.accountName && (
                                  <span className="text-slate-400">（{r.source.accountName}）</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                            {editing ? (
                              <input
                                type="number"
                                value={editing.amount}
                                onChange={(e) =>
                                  setDetailEdit({ ...editing, amount: e.target.value })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveDetailAmount();
                                  if (e.key === "Escape") setDetailEdit(null);
                                }}
                                autoFocus
                                className="w-28 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
                              />
                            ) : (
                              yen(Number(r.amount))
                            )}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {editing ? (
                              <button
                                type="button"
                                aria-label="保存"
                                title="保存"
                                onClick={saveDetailAmount}
                                className="text-indigo-600 hover:text-indigo-700"
                              >
                                <Check className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : r.journalEntryId !== null ? (
                              // 仕訳と連動した実績は仕訳側が正なのでここでは触らせない
                              <span className="text-[10px] text-slate-400">仕訳から修正</span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label="この実績を編集"
                                  title="編集"
                                  onClick={() =>
                                    setDetailEdit({ id: r.id, amount: String(r.amount) })
                                  }
                                  className="text-slate-300 hover:text-indigo-500"
                                >
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="この実績を削除"
                                  title="削除"
                                  onClick={() => deleteDetailRecord(r)}
                                  className="text-slate-300 hover:text-red-500"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">このセルの実績はすべて削除されました。</p>
            )}
          </div>
        </div>
      )}

      {/* 勘定科目・部門のマスタ管理は「設定 › 科目名設定 / 部門・担当」へ移設した。 */}
    </AppShell>
  );
}
