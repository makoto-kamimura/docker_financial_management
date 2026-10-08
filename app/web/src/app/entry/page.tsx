"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, LoadingSpinner } from "@/components/StateViews";
import { AccountMonthMatrix, type MatrixCell } from "@/components/AccountMonthMatrix";
import { ActualsConfirmPanel } from "@/components/ActualsConfirmPanel";
import { BankTransactionsCalendar } from "@/components/BankTransactionsCalendar";
import { BankTransactionsPanel } from "@/components/BankTransactionsPanel";
import { CardTransactionsPanel } from "@/components/CardTransactionsPanel";
import { LedgerBadge, LedgerTable } from "@/components/LedgerTable";
import { RecurringSuggestionsPanel } from "@/components/RecurringSuggestionsPanel";
import { TransferRulesCard } from "@/components/TransferRulesCard";
import { CsvDropzone, Notice, PageHeader, SegmentedControl, Tabs } from "@/components/ui";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";
import { SectionLead } from "@/components/Explain";
import { useViewMode } from "@/lib/use-view-mode";
import { ENTRY_HELP, textFor } from "@/lib/help-texts";
import { displayName } from "@/lib/display-name";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { buildFinancialMatrix, type MatrixRecord } from "@/lib/financial-matrix";
import { invalidateActuals } from "@/lib/invalidate-actuals";
import {
  CATEGORY_LABEL as GROUP_LABELS,
  CATEGORY_ORDER as GROUP_ORDER,
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
// CSV インポートの結果（POST /api/imports）。登録先ごとの登録件数と、重複・確定済みの月で飛ばした件数
type ImportCount = { inserted: number; skipped: number; locked: number };
type ImportResult = {
  results: {
    bank: (ImportCount & { id: number; name: string })[];
    card: (ImportCount & { id: number; name: string })[];
  } | null;
  errors: { row: number; message: string }[];
};

// 現金の履歴のページ送り（銀行・カードの履歴と同じ 30 件ずつ）
const HISTORY_PAGE_SIZE = 30;

// 実績 1 行の出どころ（GET /api/financials/matrix）。セルの内訳モーダルで表示する
type RecordSource = {
  kind: "cash" | "bank" | "card" | "journal" | "direct";
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

// 現金の明細（GET /api/actuals）。科目を付けた明細がそのまま実績になる
type CashEntry = {
  id: number;
  date: string;
  description: string;
  /** +入金 / −出金 */
  amount: number;
  categoryAccountId: number | null;
  categoryAccount: {
    id: number;
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  } | null;
};

// ── 定数 ───────────────────────────────────────────────────────────
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const INCOME_CATS = ["REVENUE", "PROFIT"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];

// 現金のカレンダーの登録フォーム。支払元・入金先は現金に固定する（銀行・カードは出どころで選ぶ）
const BLANK_CAL_FORM = {
  description: "",
  accountCode: "",
  amount: "",
  direction: "expense" as "income" | "expense",
};

const yen = (v: number) => v.toLocaleString("ja-JP") + "円";

// セル内訳モーダルに出す「どこから入った実績か」のラベル
const SOURCE_LABEL: Record<RecordSource["kind"], string> = {
  cash: "現金の明細",
  bank: "銀行の明細",
  card: "カードの明細",
  journal: "仕訳と連動",
  direct: "過去の直接入力",
};
const SOURCE_BADGE: Record<RecordSource["kind"], string> = {
  cash: "bg-emerald-50 text-emerald-700",
  bank: "bg-sky-50 text-sky-700",
  card: "bg-violet-50 text-violet-700",
  journal: "bg-amber-50 text-amber-700",
  direct: "bg-slate-100 text-slate-600",
};
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function entryAmount(e: CashEntry): { income: number; expense: number } {
  return { income: Math.max(e.amount, 0), expense: Math.max(-e.amount, 0) };
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

// カレンダー・履歴で見る出どころ。現金＝実績（現金での支出・収入）、銀行＝入出金の明細、
// カード・電子マネー＝利用・返金の明細（銀行管理・カード管理の一覧とカレンダーをここへまとめた）
type Source = "manual" | "bank" | "card";
const SOURCES: [Source, string][] = [
  ["manual", "現金"],
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
  // CSV インポートの取り込み先は銀行・カード（現金の CSV は扱わない）
  const [source, setSource] = useState<Source>(
    initial.tab === "csv" && initial.source === "manual" ? "bank" : initial.source,
  );
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

  // 現金の明細（直近 200 件）。履歴タブ（出どころが現金）を開いているときだけ取得する
  const { data: cashHistoryData, isLoading: histLoading } = useQuery({
    queryKey: ["actuals", "recent"],
    queryFn: async (): Promise<{ data: CashEntry[] }> => (await fetch("/api/actuals")).json(),
    enabled: tab === "history" && source === "manual",
  });
  const cashHistory = cashHistoryData?.data;
  const histTotal = cashHistory?.length ?? 0;
  const [histMsg, setHistMsg] = useState<string | null>(null);

  // 現金の明細の科目を変える（科目を付けた明細がそのまま実績）
  async function setCashCategory(id: number, categoryAccountId: number | null) {
    setHistMsg(null);
    const res = await fetch(`/api/actuals/${id}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setHistMsg(j.error ?? "科目の変更に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  async function deleteCashEntry(e: CashEntry) {
    if (!confirm(`「${e.description}」を削除してよいですか？`)) return;
    setHistMsg(null);
    const res = await fetch(`/api/actuals?id=${e.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setHistMsg(j.error ?? "削除に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  // 対象年度は左のメニューで選ぶ（全画面で共通）
  const matrixYear = useFiscalYear();
  // 「◯件」を押して開くセル内訳モーダル（同じ科目・月に複数の実績があるセル）
  const [cellDetail, setCellDetail] = useState<{ accountCode: string; month: number } | null>(null);

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

  const { data: cashData, isLoading: calLoading } = useQuery({
    queryKey: ["actuals", viewYear, viewMonth],
    queryFn: async (): Promise<{ data: CashEntry[] }> =>
      (await fetch(`/api/actuals?year=${viewYear}&month=${viewMonth}`)).json(),
    enabled: tab === "calendar" && source === "manual",
  });

  // 参照が毎回変わると下の useMemo が無駄に再計算されるため、ここで安定させる
  const calEntries = useMemo(() => cashData?.data ?? [], [cashData]);

  const byDay = useMemo(() => {
    const m = new Map<number, CashEntry[]>();
    for (const e of calEntries) {
      const d = new Date(e.date).getDate();
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
  const calMainAccounts = calForm.direction === "income" ? incomeAccounts : expenseAccounts;

  const byCategory = (accounts ?? []).reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  // 一覧のセル（見るだけ）。実績は明細に科目を付けると入るので、ここでは直接変えない。
  // セルを押すと、どの明細・仕訳から入った実績かの内訳を出す
  function entryCell(code: string, m: number): MatrixCell | null {
    const cell = matrixRows.find((r) => r.account.code === code)?.byMonth.get(m);
    if (!cell) return null;
    return {
      amount: cell.total,
      editable: null,
      action:
        cell.records.length > 0 ? (
          <button
            type="button"
            onClick={() => setCellDetail({ accountCode: code, month: m })}
            title="この月の実績の内訳を表示"
            className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2 whitespace-nowrap"
          >
            {cell.records.length}件
          </button>
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
      const params = new URLSearchParams({ target: source === "card" ? "card" : "bank" });
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
      // 学習ルールで科目が付いた明細はそのまま実績になるので、実績もまとめて取り直す
      invalidateActuals(queryClient);
      for (const key of [
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
          bank: [
            {
              id: bankAccountId,
              name,
              inserted: json.inserted ?? 0,
              skipped: json.skipped ?? 0,
              locked: json.locked ?? 0,
            },
          ],
          card: [],
        },
        errors: [],
      });
      queryClient.invalidateQueries({ queryKey: ["bank-txns"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      invalidateActuals(queryClient);
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
        amount: Number(calForm.amount),
        direction: calForm.direction,
      }),
    });
    if (res.ok) {
      setCalForm(BLANK_CAL_FORM);
      invalidateActuals(queryClient);
    } else {
      const j = (await res.json()) as { error?: string };
      setCalError(j.error ?? "登録に失敗しました");
    }
    setCalSaving(false);
  }

  async function handleCalDelete(id: number) {
    const res = await fetch(`/api/actuals?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setCalError(j.error ?? "削除に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  return (
    <AppShell>
      <PageHeader title="実績管理" lead={textFor(ENTRY_HELP.page, sysMode)} showYear />

      {/* タブ（予算管理と同じ並び：一覧 → 確定 → … → 履歴） */}
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(t) => {
          if (t === "csv" && source === "manual") setSource("bank");
          setTab(t);
        }}
      />

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
            options={tab === "csv" ? SOURCES.filter(([v]) => v !== "manual") : SOURCES}
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

      {/* ── カレンダータブ（出どころが現金）────────────────────────── */}
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
                                {e.categoryAccount
                                  ? displayName(e.categoryAccount, sysMode)
                                  : "未割り当て"}
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
                    {importResult.results.bank.map((r) => (
                      <li key={`b${r.id}`}>
                        銀行 {r.name}: {r.inserted.toLocaleString()} 件を登録
                        {r.skipped > 0 && `（${r.skipped.toLocaleString()} 件は取り込み済み）`}
                        {r.locked > 0 &&
                          `（${r.locked.toLocaleString()} 件は実績を確定済みの月のため飛ばしました）`}
                      </li>
                    ))}
                    {importResult.results.card.map((r) => (
                      <li key={`c${r.id}`}>
                        カード・電子マネー {r.name}: {r.inserted.toLocaleString()} 件を登録
                        {r.skipped > 0 && `（${r.skipped.toLocaleString()} 件は取り込み済み）`}
                        {r.locked > 0 &&
                          `（${r.locked.toLocaleString()} 件は実績を確定済みの月のため飛ばしました）`}
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
                銀行・カード・電子マネー（取り込み先で口座を選んだとき）
              </h3>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`date,description,amount,balance
${THIS_YEAR}-06-25,給与,300000,512000
${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980,508020`}</pre>
              <p className="mt-1 text-xs text-slate-500">
                銀行・カード会社のサイトの明細そのままの形式です（入金は正、支出は負。balance
                は銀行だけで、無くてもかまいません）。摘要が学習ルールに当たった明細には科目が付き、そのまま実績になります。
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">
                登録先の列つき（1 つのファイルで、銀行・カードに振り分ける）
              </h3>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`target,account,date,description,amount
銀行,住信SBI普通,${THIS_YEAR}-06-25,給与,300000
カード,楽天カード,${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980`}</pre>
              <p className="mt-1 text-xs text-slate-500">{ENTRY_HELP.csvRouted}</p>
            </div>
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
                    description={`${matrixCurrentYear}年の実績がありません。明細（現金・銀行・カード）をカレンダーか CSV インポートで入れ、科目を付けると実績になります。`}
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
                />
              </>
            ))}

          {/* ── 履歴（出どころが現金 = 現金の明細）。銀行・カードと同じ共通の表 ── */}
          {tab === "history" &&
            source === "manual" &&
            (histLoading && !cashHistory ? (
              <LoadingSpinner label="履歴を読み込み中…" />
            ) : (
              <>
                {histMsg && (
                  <Notice tone="error" onClose={() => setHistMsg(null)} className="mb-3">
                    {histMsg}
                  </Notice>
                )}
                <LedgerTable
                  total={histTotal}
                  offset={histOffset}
                  pageSize={HISTORY_PAGE_SIZE}
                  onPageChange={setHistOffset}
                  emptyText="現金の明細はまだありません。カレンダーから登録できます。"
                  rows={(cashHistory ?? [])
                    .slice(histOffset, histOffset + HISTORY_PAGE_SIZE)
                    .map((e) => ({
                      key: e.id,
                      date: new Date(e.date).toLocaleDateString("ja-JP"),
                      account: "現金",
                      description: e.description,
                      amount: yen(e.amount),
                      tone: e.amount < 0 ? ("out" as const) : ("in" as const),
                      category: (
                        <select
                          value={e.categoryAccountId ?? ""}
                          onChange={(ev) =>
                            setCashCategory(
                              e.id,
                              ev.target.value === "" ? null : Number(ev.target.value),
                            )
                          }
                          className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-40"
                        >
                          <option value="">未割り当て</option>
                          {GROUP_ORDER.map((cat) => {
                            const items = (byCategory[cat] ?? []).filter((a) =>
                              [...INCOME_CATS, ...EXPENSE_CATS].includes(a.category),
                            );
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
                      ),
                      status: (
                        <LedgerBadge tone={e.categoryAccountId !== null ? "emerald" : "amber"}>
                          {e.categoryAccountId !== null ? "実績" : "未割り当て"}
                        </LedgerBadge>
                      ),
                      actions: (
                        <button
                          type="button"
                          onClick={() => deleteCashEntry(e)}
                          className="text-xs text-slate-400 hover:text-red-600"
                        >
                          削除
                        </button>
                      ),
                    }))}
                />
              </>
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
                onClick={() => setCellDetail(null)}
                className="text-sm text-slate-400 hover:text-slate-600"
              >
                閉じる
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              このセルの実績の一覧です。合計 {yen(detailCell?.total ?? 0)}（
              {detailCell?.records.length ?? 0} 件）。明細の科目は履歴から変えられます。
            </p>

            {detailCell && detailCell.records.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2 pr-4 font-medium">登録日時</th>
                      <th className="text-left py-2 pr-4 font-medium">出どころ</th>
                      <th className="text-left py-2 pr-4 font-medium">内容</th>
                      <th className="text-right py-2 pr-2 font-medium">金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailCell.records.map((r) => (
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
                          {yen(Number(r.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">このセルの実績はありません。</p>
            )}
          </div>
        </div>
      )}

      {/* 勘定科目・部門のマスタ管理は「設定 › 科目名設定 / 部門・担当」へ移設した。 */}
    </AppShell>
  );
}
