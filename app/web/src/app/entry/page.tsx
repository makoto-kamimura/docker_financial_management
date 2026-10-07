"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Trash2, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, LoadingSpinner } from "@/components/StateViews";
import { AccountMonthMatrix, type MatrixCell } from "@/components/AccountMonthMatrix";
import { ActualsConfirmPanel } from "@/components/ActualsConfirmPanel";
import { BankTransactionsCalendar } from "@/components/BankTransactionsCalendar";
import { BankTransactionsPanel } from "@/components/BankTransactionsPanel";
import { CardTransactionsPanel } from "@/components/CardTransactionsPanel";
import { LedgerTable } from "@/components/LedgerTable";
import { RecurringSuggestionsPanel } from "@/components/RecurringSuggestionsPanel";
import { TransferRulesCard } from "@/components/TransferRulesCard";
import { CsvDropzone, Notice, PageHeader, SegmentedControl, Tabs } from "@/components/ui";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";
import { SectionLead } from "@/components/Explain";
import { useViewMode } from "@/lib/use-view-mode";
import { ENTRY_HELP, textFor } from "@/lib/help-texts";
import { displayName } from "@/lib/display-name";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { buildFinancialMatrix, editableRecord, type MatrixRecord } from "@/lib/financial-matrix";
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
// CSV インポートの結果（POST /api/imports）。登録先ごとの登録件数と、重複で飛ばした件数
type ImportCount = { inserted: number; skipped: number };
type ImportResult = {
  results: {
    actual: ImportCount | null;
    bank: (ImportCount & { id: number; name: string })[];
    card: (ImportCount & { id: number; name: string })[];
  } | null;
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
  /** 実績を確定済みの月 */
  confirmedMonths: number[];
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

type Tab = "manual" | "calendar" | "confirm" | "csv" | "history";
const TABS: readonly (readonly [Tab, string])[] = [
  ["manual", "一覧"],
  ["calendar", "カレンダー"],
  ["confirm", "実績の確定"],
  ["csv", "CSV インポート"],
  ["history", "履歴"],
];

const TAB_IDS: Tab[] = ["manual", "calendar", "confirm", "csv", "history"];

// カレンダー・履歴で見る出どころ。手動＝実績（支出・収入）、銀行＝入出金の明細、
// カード・電子マネー＝利用・返金の明細（銀行管理・カード管理の一覧とカレンダーをここへまとめた）
type Source = "manual" | "bank" | "card";
const SOURCES: [Source, string][] = [
  ["manual", "手動"],
  ["bank", "銀行"],
  ["card", "カード・電子マネー"],
];
type SourceAccount = { id: number; name: string };

// 他の画面から ?tab=confirm&month=YYYY-MM のように開けるようにする（ダッシュボードの状況の 1 行など）。
// 銀行管理・カード管理の「明細を見る」からは ?tab=history&source=bank&account=ID で開く
function useInitialTab(): {
  tab: Tab;
  month: string | undefined;
  source: Source;
  account: number | null;
} {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const month = searchParams.get("month");
  const source = searchParams.get("source");
  const account = Number(searchParams.get("account"));
  return {
    tab: TAB_IDS.includes(tab as Tab) ? (tab as Tab) : "manual",
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    source: source === "bank" || source === "card" ? source : "manual",
    account: Number.isInteger(account) && account > 0 ? account : null,
  };
}

// ── ページ ─────────────────────────────────────────────────────────
export default function EntryPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <EntryContent />
    </Suspense>
  );
}

function EntryContent() {
  const queryClient = useQueryClient();
  const sysMode = useViewMode();

  // ── タブ ──────────────────────────────────────────────────────
  const initial = useInitialTab();
  const [tab, setTab] = useState<Tab>(initial.tab);

  // ── 出どころ（カレンダー・履歴で共通）──────────────────────────
  const [source, setSource] = useState<Source>(initial.source);
  // 銀行は null で「すべての銀行」。カードは 1 枚ずつ扱う（null なら最初のカード）
  const [bankAccountId, setBankAccountId] = useState<number | null>(
    initial.source === "bank" ? initial.account : null,
  );
  const [cardAccountId, setCardAccountId] = useState<number | null>(
    initial.source === "card" ? initial.account : null,
  );
  // 出どころ（取り込み先）を選ぶタブ。CSV インポートでは、登録先の列が無い CSV の取り込み先になる
  const sourceTab = tab === "calendar" || tab === "history" || tab === "csv";
  // 銀行の履歴の「振替を登録（銀行 → 銀行）」のモーダル
  const [bankTransferOpen, setBankTransferOpen] = useState(false);
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    enabled: sourceTab && source === "bank",
    queryFn: async (): Promise<SourceAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });
  const { data: cardAccounts } = useQuery({
    queryKey: ["linked-accounts"],
    enabled: sourceTab && source === "card",
    queryFn: async (): Promise<SourceAccount[]> =>
      (await (await fetch("/api/linked-accounts")).json()).data ?? [],
  });
  const cardId =
    cardAccounts?.find((a) => a.id === cardAccountId)?.id ?? cardAccounts?.[0]?.id ?? null;

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
    // 履歴タブ（出どころが手動）を開いているときだけ取得・更新する
    enabled: tab === "history" && source === "manual",
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const recentHistory = history?.data;
  const histTotal = history?.total ?? 0;

  // 対象年度は左のメニューで選ぶ（全画面で共通）
  const matrixYear = useFiscalYear();
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
  const matrixCurrentYear = matrixYear;

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
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // ── カレンダー ────────────────────────────────────────────────
  // カレンダーの年は対象年度に合わせる。月を送って年をまたいだら、対象年度も変える
  const viewYear = matrixYear;
  const setViewYear = (f: (y: number) => number) => setFiscalYear(f(viewYear));
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  const [calForm, setCalForm] = useState(BLANK_CAL_FORM);
  const [calSaving, setCalSaving] = useState(false);
  const [calError, setCalError] = useState("");

  const { data: journalData, isLoading: calLoading } = useQuery({
    queryKey: ["actuals", viewYear, viewMonth],
    queryFn: async (): Promise<{ data: JournalEntry[] }> =>
      (await fetch(`/api/actuals?year=${viewYear}&month=${viewMonth}`)).json(),
    enabled: tab === "calendar" && source === "manual",
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

  // 実績 1 行の金額更新。一覧のセル編集とセル内訳モーダルの両方から使う。失敗ならメッセージを返す
  async function updateRecordAmount(id: number, amount: number): Promise<string | null> {
    const res = await fetch(`/api/financials/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      invalidateRecords();
      return null;
    }
    const err = await res.json().catch(() => ({}));
    return err.error ?? "更新に失敗しました。";
  }

  // 内訳モーダルからの更新・削除。削除は取り消せないので確認を挟む
  async function saveDetailAmount() {
    if (!detailEdit) return;
    const message = await updateRecordAmount(detailEdit.id, Number(detailEdit.amount));
    setMatrixError(message);
    if (!message) setDetailEdit(null);
  }

  async function deleteDetailRecord(r: MatrixEntry) {
    if (!confirm(`${yen(Number(r.amount))} の実績を削除します。よろしいですか？`)) return;
    if (detailEdit?.id === r.id) setDetailEdit(null);
    setMatrixError(await deleteMatrixCell(r.id));
  }

  async function deleteMatrixCell(id: number): Promise<string | null> {
    const res = await fetch(`/api/financials/${id}`, { method: "DELETE" });
    if (res.ok) {
      invalidateRecords();
      return null;
    }
    const err = await res.json().catch(() => ({}));
    return err.error ?? "削除に失敗しました。";
  }

  async function addMatrixCell(
    accountCode: string,
    month: number,
    amount: number,
  ): Promise<string | null> {
    const res = await fetch("/api/financials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountCode, fiscalYear: matrixCurrentYear, month, amount }),
    });
    if (res.ok) {
      invalidateRecords();
      return null;
    }
    const err = await res.json().catch(() => ({}));
    return err.error ?? "登録に失敗しました。";
  }

  // 一覧のセル。同じ月に複数件あるセルは内訳から、仕訳と連動した実績は仕訳帳から直す
  function entryCell(code: string, m: number): MatrixCell | null {
    const cell = matrixRows.find((r) => r.account.code === code)?.byMonth.get(m);
    if (!cell) return null;
    const single = editableRecord(cell);
    return {
      amount: cell.total,
      editable:
        single && single.journalEntryId === null
          ? { id: single.id, amount: Number(single.amount) }
          : null,
      action:
        cell.records.length > 1 ? (
          // 複数件のセルはその場で編集できないため、内訳モーダルで 1 行ずつ確認して直す
          <button
            type="button"
            onClick={() => setCellDetail({ accountCode: code, month: m })}
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
        ) : undefined,
    };
  }

  // ── CSV ハンドラ ─────────────────────────────────────────────
  // 取り込みの前の確認（銀行・カードへ、登録先の列が無い CSV を入れるとき。取り違えを防ぐ）
  const [pendingImport, setPendingImport] = useState<{ file: File; label: string } | null>(null);

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImportResult(null);
    setImportError(null);
    // ヘッダに target 列があれば行ごとに振り分ける（画面の取り込み先は使わない）
    const header = (await file.text()).split(/\r?\n/, 1)[0] ?? "";
    const routed = header
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, ""))
      .includes("target");
    if (!routed && source !== "manual") {
      const list = source === "bank" ? bankAccounts : cardAccounts;
      const id = source === "bank" ? bankAccountId : cardId;
      const account = list?.find((a) => a.id === id);
      if (!account) {
        setImportError(
          "取り込み先の口座を選んでください（CSV に target・account の列があれば、行ごとに振り分けます）。",
        );
        return;
      }
      setPendingImport({
        file,
        label: `${source === "bank" ? "銀行" : "カード・電子マネー"}: ${account.name}`,
      });
      return;
    }
    await runImport(file);
  }

  async function runImport(file: File) {
    setPendingImport(null);
    setImporting(true);
    try {
      const params = new URLSearchParams({ target: source === "manual" ? "actual" : source });
      const id = source === "bank" ? bankAccountId : source === "card" ? cardId : null;
      if (id !== null) params.set("accountId", String(id));
      const res = await fetch(`/api/imports?${params}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: file,
      });
      const json = await res
        .clone()
        .json()
        .catch(() => null);
      if (json && Array.isArray(json.errors)) {
        setImportResult(json as ImportResult);
      } else if (!res.ok) {
        setImportError(await importErrorMessage(res));
      }
      // 実績・銀行・カードのどれに入っても表示が変わるので、まとめて取り直す
      for (const key of [
        "financials-matrix",
        "recent-history",
        "bank-txns",
        "card-txns",
        "bank-accounts",
        "cash-outlook",
        "card-usage-trend",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch {
      setImportError(importNetworkErrorMessage);
    } finally {
      setImporting(false);
    }
  }

  // 銀行の自動取得（同期）。銀行管理の CSV インポートから移した
  async function syncBank() {
    if (bankAccountId === null) return;
    setImportResult(null);
    setImportError(null);
    const res = await fetch(`/api/bank-accounts/${bankAccountId}/sync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const name = bankAccounts?.find((a) => a.id === bankAccountId)?.name ?? "";
      setImportResult({
        results: {
          actual: null,
          bank: [{ id: bankAccountId, name, inserted: json.fetched ?? 0, skipped: 0 }],
          card: [],
        },
        errors: [],
      });
      queryClient.invalidateQueries({ queryKey: ["bank-txns"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    } else {
      setImportError("自動取得に失敗しました。");
    }
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
      <PageHeader title="実績管理" lead={textFor(ENTRY_HELP.page, sysMode)} showYear />

      {/* タブ（予算管理と同じ並び：一覧 → 確定 → … → 履歴） */}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {/* 実績の新規登録は下の「科目×月テーブル」のセルから行う（旧「新規登録」フォームは廃止）。
          科目名の変更は「設定 › 科目名設定」に集約した。 */}

      {/* 開いているタブで何ができるかの説明（実績の確定タブは中に説明がある） */}
      {tab !== "confirm" && (
        <SectionLead className="-mt-3 mb-4">
          {
            {
              manual: ENTRY_HELP.table,
              calendar: ENTRY_HELP.calendar,
              csv: ENTRY_HELP.csv,
              history: ENTRY_HELP.history,
            }[tab]
          }
        </SectionLead>
      )}

      {/* ── 出どころの選択（カレンダー・履歴）。種別を選び、銀行・カードのときは口座も選ぶ ── */}
      {sourceTab && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={SOURCES.map(([v, l]) =>
              tab === "csv" && v === "manual" ? ([v, "実績"] as [Source, string]) : [v, l],
            )}
            value={source}
            onChange={setSource}
          />
          {source === "bank" && (
            <select
              aria-label="銀行"
              className="input-field w-60"
              value={bankAccountId ?? ""}
              onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{tab === "csv" ? "口座を選んでください" : "すべての銀行"}</option>
              {bankAccounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {source === "card" &&
            (cardAccounts && cardAccounts.length === 0 ? (
              <span className="text-xs text-slate-500">
                カード・電子マネーが登録されていません（カード・電子マネー管理で登録します）
              </span>
            ) : (
              <select
                aria-label="カード・電子マネー"
                className="input-field w-60"
                value={cardId ?? ""}
                onChange={(e) => setCardAccountId(Number(e.target.value))}
              >
                {cardAccounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ))}
        </div>
      )}

      {/* ── 銀行・カードのカレンダーと履歴（銀行管理・カード管理から移した部品）── */}
      {tab === "calendar" && source === "bank" && (
        <BankTransactionsCalendar accountId={bankAccountId} />
      )}
      {tab === "calendar" && source === "card" && cardId !== null && (
        <CardTransactionsPanel view="calendar" accountId={cardId} />
      )}
      {/* 銀行の履歴: 毎月の入出金の候補 → 毎月の入出金（資金移動ルール）→ 振替紐付け → 明細の一覧。
          ルールと振替は銀行管理の資金移動スケジュールから移した */}
      {tab === "history" && source === "bank" && (
        <>
          <RecurringSuggestionsPanel accountId={bankAccountId} />
          <TransferRulesCard
            accountId={bankAccountId}
            onRegisterTransfer={() => setBankTransferOpen(true)}
          />
          <BankTransactionsPanel
            view="recurring"
            recurringParts={["register", "match"]}
            bankTransferOpen={bankTransferOpen}
            onBankTransferOpenChange={setBankTransferOpen}
            accountId={bankAccountId}
          />
          <BankTransactionsPanel view="list" accountId={bankAccountId} />
        </>
      )}
      {tab === "history" && source === "card" && cardId !== null && (
        <CardTransactionsPanel view="list" accountId={cardId} />
      )}

      {/* ── 実績の確定タブ（② その月の実績。明細の最終日がそろったら確定する）── */}
      {tab === "confirm" && <ActualsConfirmPanel mode={sysMode} initialMonth={initial.month} />}

      {/* ── カレンダータブ（出どころが手動）────────────────────────── */}
      {tab === "calendar" && source === "manual" && (
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
                    <button type="submit" disabled={calSaving} className="btn-primary text-xs mt-1">
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
          <CsvDropzone busy={importing} onFile={importFile} />
          {/* 銀行の自動取得（同期）。銀行管理の CSV インポートから移した */}
          {source === "bank" && bankAccountId !== null && (
            <div className="card flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-700">自動取得（同期）</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  口座と連携して最新の明細を取得します
                </p>
              </div>
              <button onClick={syncBank} className="btn-secondary whitespace-nowrap">
                同期する
              </button>
            </div>
          )}
          {importResult && (
            <div
              className={`card border ${importResult.errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
            >
              {importResult.results ? (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">✅</span>
                  <ul className="text-sm text-slate-800 space-y-0.5">
                    {importResult.results.actual && (
                      <li>
                        実績: {importResult.results.actual.inserted.toLocaleString()} 件を登録
                        {importResult.results.actual.skipped > 0 &&
                          `（${importResult.results.actual.skipped.toLocaleString()} 件は同じ内容が登録済み）`}
                      </li>
                    )}
                    {importResult.results.bank.map((r) => (
                      <li key={`b${r.id}`}>
                        銀行 {r.name}: {r.inserted.toLocaleString()} 件を登録
                        {r.skipped > 0 && `（${r.skipped.toLocaleString()} 件は取り込み済み）`}
                      </li>
                    ))}
                    {importResult.results.card.map((r) => (
                      <li key={`c${r.id}`}>
                        カード・電子マネー {r.name}: {r.inserted.toLocaleString()} 件を登録
                        {r.skipped > 0 && `（${r.skipped.toLocaleString()} 件は取り込み済み）`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">⚠️</span>
                  <p className="text-sm font-semibold text-slate-800">
                    {importResult.errors.length} 件のエラーがあるため、取り込みませんでした
                  </p>
                </div>
              )}
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
          {importError && <Notice tone="error">{importError}</Notice>}

          {/* 書式の説明（実績 / 銀行・カード / 登録先の列つき） */}
          <div className="card bg-slate-50 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">
                実績（取り込み先で「実績」を選んだとき）
              </h3>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`accountCode,fiscalYear,month,amount
H1000,${THIS_YEAR},1,350000
H2000,${THIS_YEAR},1,45000`}</pre>
              <p className="mt-1 text-xs text-slate-500">
                accountCode は勘定科目コード、fiscalYear は年度、month は月（1〜12）、amount
                は金額（円）です。
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">
                銀行・カード・電子マネー（取り込み先で口座を選んだとき）
              </h3>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`date,description,amount,balance
${THIS_YEAR}-06-25,給与,300000,512000
${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980,508020`}</pre>
              <p className="mt-1 text-xs text-slate-500">
                銀行・カード会社のサイトの明細そのままの形式です（入金は正、支出は負。balance
                は銀行だけで、無くてもかまいません）。
                カード・電子マネーは取り込み時に符号を反転し、利用＝正、返金＝負として記録します。
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">
                登録先の列つき（1 つのファイルで、実績・銀行・カードに振り分ける）
              </h3>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`target,account,date,description,amount,accountCode
実績,,${THIS_YEAR}-06-30,,350000,H1000
銀行,住信SBI普通,${THIS_YEAR}-06-25,給与,300000,
カード,楽天カード,${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980,`}</pre>
              <p className="mt-1 text-xs text-slate-500">{ENTRY_HELP.csvRouted}</p>
            </div>
          </div>

          {/* 給与明細の項目は、下の科目コードを使ってこの CSV から登録する
              （旧「給与明細 CSV の取込」は廃止し、科目マスタ側に項目を用意した） */}
          <div className="card bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              給与明細の内容を登録する場合の科目コード
            </h3>
            <p className="text-xs text-slate-500 mb-2">{ENTRY_HELP.payslip}</p>
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
          {/* ── 科目×月テーブル（一覧タブ。予算管理の一覧と同じ部品）──────── */}
          {tab === "manual" &&
            (matrixLoading && !matrixData ? (
              <LoadingSpinner label="実績を読み込み中…" />
            ) : (
              <>
                {matrixRows.length === 0 && (
                  <EmptyState
                    title="実績データがありません"
                    description={`${matrixCurrentYear}年の実績がありません。CSV インポートかカレンダーから登録するか、下の「科目を追加」から入れてください。`}
                  />
                )}
                <AccountMonthMatrix
                  mode={sysMode}
                  year={matrixCurrentYear}
                  noun="実績"
                  rows={matrixRows.map(
                    (r) => accounts?.find((a) => a.code === r.account.code) ?? r.account,
                  )}
                  allAccounts={accounts ?? []}
                  getCell={entryCell}
                  lockedMonths={new Set(matrixData?.confirmedMonths ?? [])}
                  lockedTitle={(m) => `${m}月の実績は確定済みです。${ENTRY_HELP.actualsLocked}`}
                  onAdd={addMatrixCell}
                  onSave={updateRecordAmount}
                  onDelete={deleteMatrixCell}
                />
              </>
            ))}

          {/* ── 履歴（出どころが手動 = 実績の変更記録）。銀行・カードと同じ共通の表 ── */}
          {tab === "history" &&
            source === "manual" &&
            (histLoading && !recentHistory ? (
              <LoadingSpinner label="履歴を読み込み中…" />
            ) : (
              <LedgerTable
                total={histTotal}
                offset={histOffset}
                pageSize={HISTORY_PAGE_SIZE}
                onPageChange={setHistOffset}
                emptyText="まだ履歴はありません。"
                headers={{
                  date: (
                    <button
                      type="button"
                      onClick={() => toggleHistorySort("changedAt")}
                      className={`inline-flex items-center gap-1 hover:text-slate-700 ${
                        histSort === "changedAt" ? "text-indigo-700 font-semibold" : ""
                      }`}
                    >
                      日付（変更日時）
                      <span className="text-[10px]">
                        {histSort === "changedAt" ? (histOrder === "desc" ? "▼" : "▲") : "↕"}
                      </span>
                    </button>
                  ),
                  category: (
                    <button
                      type="button"
                      onClick={() => toggleHistorySort("account")}
                      className={`inline-flex items-center gap-1 hover:text-slate-700 ${
                        histSort === "account" ? "text-indigo-700 font-semibold" : ""
                      }`}
                    >
                      科目
                      <span className="text-[10px]">
                        {histSort === "account" ? (histOrder === "desc" ? "▼" : "▲") : "↕"}
                      </span>
                    </button>
                  ),
                  amount: (
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
                  ),
                }}
                rows={(recentHistory ?? []).map((h) => ({
                  key: h.historyId,
                  date: fmtDate(h.changedAt),
                  account: "手動",
                  description: `${h.period.fiscalYear}年${h.period.month}月の実績`,
                  amount: yen(h.amount),
                  tone: "none" as const,
                  category: (
                    <>
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
                    </>
                  ),
                  status: (
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLOR[h.action] ?? ""}`}
                    >
                      {ACTION_LABEL[h.action] ?? h.action}
                    </span>
                  ),
                }))}
              />
            ))}
        </div>
      )}

      {/* 取り込み先の確認（銀行・カードに、登録先の列が無い CSV を入れるとき） */}
      {pendingImport && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-1">CSV 取込先の確認</h2>
            <p className="text-xs text-slate-500 mb-4">
              CSV の中身から取込先は判別できません。下記の明細として登録します。
            </p>
            <dl className="text-sm border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
              <div className="flex gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 text-slate-500">ファイル</dt>
                <dd className="text-slate-700 break-all">{pendingImport.file.name}</dd>
              </div>
              <div className="flex gap-3 px-3 py-2 bg-amber-50">
                <dt className="w-20 shrink-0 text-slate-500">取込先</dt>
                <dd className="font-semibold text-slate-800">{pendingImport.label}</dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => runImport(pendingImport.file)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                取り込む
              </button>
            </div>
          </div>
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
