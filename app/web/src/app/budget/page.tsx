"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Home, CreditCard } from "lucide-react";
import { Modal } from "@/components/Modal";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";
import { BudgetAllocationPanel } from "@/components/BudgetAllocationPanel";
import { BudgetCalendar } from "@/components/BudgetCalendar";
import { BudgetConfirmPanel } from "@/components/BudgetConfirmPanel";
import { BudgetVariancePanel } from "@/components/BudgetVariancePanel";
import {
  AccountMonthMatrix,
  type MatrixAccount,
  type MatrixCell,
} from "@/components/AccountMonthMatrix";
import { CsvDropzone, Notice, PageHeader, Pager, Tabs } from "@/components/ui";
import { useFiscalYear } from "@/lib/client/use-fiscal-year";
import { InfoNote, SectionLead } from "@/components/Explain";
import { useViewMode } from "@/lib/client/use-view-mode";
import { BUDGET_HELP, textFor } from "@/lib/shared/help-texts";
import { displayName } from "@/lib/shared/display-name";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/client/import-error";
import { CHANGE_ACTION_LABEL as ACTION_LABEL } from "@/lib/shared/labels";
import {
  BUDGET_SOURCE_LABEL,
  buildBudgetCellDetail,
  type BudgetCellItem,
} from "@/lib/shared/budget-cell-detail";
import { amountText, yen } from "@/lib/common/format";

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
  /** 予算を確定済みの月（この月の予算は編集できない） */
  confirmedMonths?: number[];
  /** カレンダーで登録した予算（セルの内訳に出す） */
  items?: (BudgetCellItem & { accountCode: string; month: number })[];
};
type ImportResult = { imported: number; skipped?: number; errors: string[] };
type Tab = "manual" | "calendar" | "allocation" | "variance" | "confirm" | "csv" | "history";
const TABS: readonly (readonly [Tab, string])[] = [
  ["manual", "一覧"],
  ["calendar", "カレンダー"],
  ["variance", "予実差確認"],
  ["confirm", "予算の確定"],
  ["csv", "CSV インポート"],
  ["history", "履歴"],
  ["allocation", "設定"],
];

const TAB_IDS: Tab[] = [
  "manual",
  "calendar",
  "allocation",
  "variance",
  "confirm",
  "csv",
  "history",
];
// 他の画面から ?tab=confirm&month=YYYY-MM のように開けるようにする（ダッシュボードの状況の 1 行など）。
// month は予実差確認なら比べる月、予算の確定なら予算の月
function useInitialTab(): { tab: Tab; month: string | undefined } {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const month = searchParams.get("month");
  return {
    tab: TAB_IDS.includes(tab as Tab) ? (tab as Tab) : "manual",
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
  };
}

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

const now = new Date();
const THIS_YEAR = now.getFullYear();

// 「適正 …」の説明（セルの title と表の注記で共用）
const GUIDE_HELP = BUDGET_HELP.guide;

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
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BudgetContent />
    </Suspense>
  );
}

function BudgetContent() {
  const qc = useQueryClient();
  const sysMode = useViewMode();
  const initial = useInitialTab();
  const [tab, setTab] = useState<Tab>(initial.tab);
  // 予実差確認・予算の確定を、指定した月で開く（URL か、もう一方のタブのボタンから）。
  // key を変えてパネルを作り直し、その月から始める。月は開いたタブにだけ渡す
  const [cycleNav, setCycleNav] = useState<{ tab: Tab; month?: string; key: number }>({
    tab: initial.tab,
    month: initial.month,
    key: 0,
  });
  const openCycleTab = (next: "variance" | "confirm", month: string) => {
    setCycleNav((n) => ({ tab: next, month, key: n.key + 1 }));
    setTab(next);
  };
  const cycleMonthFor = (t: Tab) => (cycleNav.tab === t ? cycleNav.month : undefined);

  // 履歴タブのページングとソート
  const [histOffset, setHistOffset] = useState(0);
  const [histSort, setHistSort] = useState<HistorySort>("changedAt");
  const [histOrder, setHistOrder] = useState<"asc" | "desc">("desc");

  // CSV インポート
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // 年度未選択時はサーバー既定（GET /api/budgets の暦年）と同じ当年を使う。
  // 4 月始まりで判定すると 1〜3 月に表と「適正額」「履歴」「セル登録」の年度がずれる。
  // 対象年度は左のメニューで選ぶ（全画面で共通）。変わったら履歴は 1 ページ目に戻す
  const year = useFiscalYear();
  useEffect(() => setHistOffset(0), [year]);

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", year],
    queryFn: async (): Promise<BudgetResponse> => (await fetch(`/api/budgets?year=${year}`)).json(),
  });

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

  // 一覧に出す科目（予算か自動反映のある科目）。並び替えと「科目を追加」は AccountMonthMatrix が行う
  const rowAccounts: MatrixAccount[] = accounts
    ? accounts.filter(
        (a) =>
          grouped.has(a.code) ||
          overlayAccountCodes.has(a.code) ||
          debtOverlayAccountCodes.has(a.code),
      )
    : Array.from(grouped.values()).map((g) => ({
        code: g.account.code,
        name: g.account.name,
        category: "",
      }));

  const confirmedMonths = new Set(data?.confirmedMonths ?? []);

  // 書き込みの失敗（確定済みの月など）のメッセージ。成功なら null
  async function failure(res: Response): Promise<string | null> {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    if (res.ok) return null;
    const err = await res.json().catch(() => ({}));
    return typeof err.error === "string" ? err.error : "予算の保存に失敗しました";
  }

  const addBudgetCell = async (accountCode: string, month: number, amount: number) =>
    failure(
      await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCode, fiscalYear: year, month, amount }),
      }),
    );

  const saveCell = async (id: number, amount: number) =>
    failure(
      await fetch(`/api/budgets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      }),
    );

  const deleteBudget = async (id: number) =>
    failure(await fetch(`/api/budgets/${id}`, { method: "DELETE" }));

  // セルの内訳（カレンダーの登録・一覧などで入れた額・自動加算）。lib/shared/budget-cell-detail.ts
  function cellDetailOf(code: string, m: number) {
    const cell = grouped.get(code)?.byMonth.get(m);
    return buildBudgetCellDetail({
      budgetAmount: cell ? Number(cell.amount) : 0,
      items: (data?.items ?? []).filter((i) => i.accountCode === code && i.month === m),
      loanOverlay: overlayMap.get(`${code}:${m}`) ?? 0,
      assetDebtOverlay: debtOverlayMap.get(`${code}:${m}`) ?? 0,
      assetNames: debtOverlayAssetNames.get(code),
    });
  }
  const [cellDetail, setCellDetail] = useState<{ code: string; month: number } | null>(null);

  // 一覧のセル。予算に自動反映（ローン返済・負債返済分）を足して出し、適正額を添える
  function budgetCell(code: string, m: number): MatrixCell | null {
    const cell = grouped.get(code)?.byMonth.get(m);
    const auto = overlayMap.get(`${code}:${m}`) ?? 0;
    const debtAuto = debtOverlayMap.get(`${code}:${m}`) ?? 0;
    const guideAmount = guideMap.get(`${code}:${m}`) ?? 0;
    if (!cell && auto === 0 && debtAuto === 0) return null;
    // カレンダーの登録があるセル・出どころが 2 つ以上あるセルは、内訳を開いて確かめる
    const detail = cellDetailOf(code, m);
    const hasItems = detail.rows.some((r) => r.kind === "calendar");
    const showDetail = hasItems || detail.rows.length > 1;
    return {
      amount: (cell ? Number(cell.amount) : 0) + auto + debtAuto,
      // カレンダーの登録があるセルは合計をその場で書き換えさせない（内訳と合わなくなるため）
      editable: cell && !hasItems ? { id: cell.id, amount: Number(cell.amount) } : null,
      action: showDetail ? (
        <button
          type="button"
          onClick={() => setCellDetail({ code, month: m })}
          title="この月の予算の内訳を表示"
          className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2 whitespace-nowrap"
        >
          {detail.rows.length}件
        </button>
      ) : undefined,
      extras: (
        <>
          {auto > 0 && (
            <div className="text-[10px] text-indigo-500">
              {cell ? "内 " : ""}ローン返済 {cell ? amountText(auto) : "自動反映"}
            </div>
          )}
          {debtAuto > 0 && (
            <div className="text-[10px] text-amber-600">
              {cell ? "内 " : ""}負債返済分 {cell ? amountText(debtAuto) : "自動反映"}
            </div>
          )}
          {guideAmount > 0 && (
            <div className="text-[10px] text-emerald-600" title={GUIDE_HELP}>
              適正 {amountText(guideAmount)}
            </div>
          )}
        </>
      ),
    };
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
    }
  }

  return (
    <AppShell>
      <PageHeader title="予算管理" lead={textFor(BUDGET_HELP.page, sysMode)} showYear />

      {/* タブ（予算と実績で同じ並び：一覧 → 確定 → … → 履歴。予算配分の「設定」は右端） */}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {/* 予算の追加は下の表のセル（「—」をクリック）から行う。旧「予算を追加」フォームは廃止した。 */}

      {/* ── CSV インポートタブ ──────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6 mb-6">
          <SectionLead className="-mb-3">{BUDGET_HELP.csv}</SectionLead>
          <CsvDropzone busy={importing} onFile={importFile} />

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
          {importError && <Notice tone="error">{importError}</Notice>}

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

      {/* ── 設定タブ（予算配分のルール。旧「設定 › 予算配分ルール」から移設）──
          ルールの割合は一覧の「適正 …」にも反映される。 */}
      {tab === "allocation" && <BudgetAllocationPanel />}

      {/* ── 予実差確認タブ（選んだ月の予算と実績を見比べる）── */}
      {tab === "variance" && (
        <BudgetVariancePanel
          key={`variance-${cycleNav.key}`}
          mode={sysMode}
          initialMonth={cycleMonthFor("variance")}
          onOpenConfirm={(m) => openCycleTab("confirm", m)}
        />
      )}

      {/* ── 予算の確定タブ（予算の月の予算案を、前月の差額の扱いから作って確定する）── */}
      {tab === "confirm" && (
        <BudgetConfirmPanel
          key={`confirm-${cycleNav.key}`}
          mode={sysMode}
          initialMonth={cycleMonthFor("confirm")}
          onOpenVariance={(m) => openCycleTab("variance", m)}
        />
      )}

      {/* ── 履歴タブ（実績管理の履歴と同じ見た目）──────────── */}
      {tab === "history" &&
        (histLoading ? (
          <LoadingSpinner label="履歴を読み込み中…" />
        ) : histRows.length === 0 ? (
          <>
            <SectionLead>{BUDGET_HELP.history}</SectionLead>
            <p className="text-sm text-slate-400">まだ{year}年度の履歴はありません。</p>
          </>
        ) : (
          <>
            <SectionLead>{BUDGET_HELP.history}</SectionLead>
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
                      <td className="py-2 text-right font-mono text-slate-800">{yen(h.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                offset={histOffset}
                pageSize={HISTORY_PAGE_SIZE}
                total={histTotal}
                onChange={setHistOffset}
                className="pt-3 mt-3 border-t border-slate-100"
              />
            </div>
          </>
        ))}

      {/* 配分提案（収入からの推奨配分）は「設定」タブに集約した。
          ここでは下の表に「適正 …」として推奨額を重ねて表示する。 */}

      {/* ── 予算テーブル（一覧タブのみ）── */}
      {tab === "manual" && (
        <>
          <SectionLead>{BUDGET_HELP.table}</SectionLead>
          {isLoading ? (
            <LoadingSpinner label="予算を読み込み中…" />
          ) : (
            <>
              {rowAccounts.length === 0 && (
                <EmptyState title="予算データがありません" description={BUDGET_HELP.empty} />
              )}
              <AccountMonthMatrix
                mode={sysMode}
                year={year}
                noun="予算"
                rows={rowAccounts}
                allAccounts={accounts ?? []}
                getCell={budgetCell}
                emptyCellLabel={(code, m) => {
                  const g = guideMap.get(`${code}:${m}`) ?? 0;
                  return g > 0 ? (
                    <span className="text-[10px] text-emerald-600">適正 {amountText(g)}</span>
                  ) : undefined;
                }}
                rowBadges={(code) => (
                  <>
                    {overlayAccountCodes.has(code) && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded"
                        title="ローンの月々の返済額が自動加算されています"
                      >
                        <Home className="w-3 h-3" aria-hidden="true" />
                        自動反映
                      </span>
                    )}
                    {debtOverlayAccountCodes.has(code) && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded"
                        title={`実物資産（${(debtOverlayAssetNames.get(code) ?? []).join("・")}）の負債残高を解消予定月まで月割りして自動加算しています`}
                      >
                        <CreditCard className="w-3 h-3" aria-hidden="true" />
                        返済分
                      </span>
                    )}
                  </>
                )}
                lockedMonths={confirmedMonths}
                lockedTitle={(m) => `${m}月の予算は確定済みです。${BUDGET_HELP.cycleLocked}`}
                legend={
                  ((guide ?? []).length > 0 ||
                    overlayAccountCodes.size > 0 ||
                    debtOverlayAccountCodes.size > 0) && (
                    <InfoNote title="表の印の見かた" className="mx-4 mt-3">
                      <ul className="space-y-0.5">
                        {(guide ?? []).length > 0 && (
                          <li>
                            <span className="font-medium text-emerald-700">適正 …</span>：
                            {GUIDE_HELP}
                            割合は
                            <button
                              type="button"
                              onClick={() => setTab("allocation")}
                              className="underline underline-offset-2 mx-1 text-indigo-600 hover:text-indigo-800"
                            >
                              「設定」タブ
                            </button>
                            で変えられます。
                          </li>
                        )}
                        {overlayAccountCodes.size > 0 && (
                          <li>
                            <span className="font-medium text-indigo-600">自動反映</span>：
                            {BUDGET_HELP.autoLoan}
                          </li>
                        )}
                        {debtOverlayAccountCodes.size > 0 && (
                          <li>
                            <span className="font-medium text-amber-600">返済分</span>：
                            {BUDGET_HELP.autoDebt}
                          </li>
                        )}
                      </ul>
                    </InfoNote>
                  )
                }
                onAdd={addBudgetCell}
                onSave={saveCell}
                onDelete={deleteBudget}
              />
            </>
          )}
        </>
      )}

      {/* ── カレンダータブ（日付を選んで予算を登録。その科目・月の予算に足される）── */}
      {tab === "calendar" && (
        <BudgetCalendar
          mode={sysMode}
          accounts={accounts ?? []}
          confirmedMonths={data?.confirmedMonths ?? []}
        />
      )}

      {/* ── セルの内訳（実績管理の内訳と同じ形）── */}
      {cellDetail &&
        (() => {
          const detail = cellDetailOf(cellDetail.code, cellDetail.month);
          const account = accounts?.find((a) => a.code === cellDetail.code);
          const locked = confirmedMonths.has(cellDetail.month);
          return (
            <Modal size="xl">
              <div className="flex items-start justify-between gap-4 mb-1">
                <h2 className="text-lg font-bold text-slate-800">
                  {account ? displayName(account, sysMode) : "予算の内訳"}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {year}年{cellDetail.month}月
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
                {BUDGET_HELP.cellDetail} 合計 {yen(detail.total)}（{detail.rows.length} 件）
              </p>
              {detail.rows.length === 0 ? (
                <p className="text-sm text-slate-400">このセルの予算はありません。</p>
              ) : (
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
                      {detail.rows.map((r, i) => (
                        <tr key={r.kind === "calendar" ? `c${r.id}` : `${r.kind}${i}`}>
                          <td className="py-2 pr-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                            {r.kind === "calendar"
                              ? new Date(r.createdAt).toLocaleString("ja-JP", {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {BUDGET_SOURCE_LABEL[r.kind]}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-xs text-slate-600">
                            {r.kind === "calendar" ? (
                              <>
                                {new Date(`${r.date}T00:00:00`).toLocaleDateString("ja-JP")} ·{" "}
                                {r.description}
                              </>
                            ) : r.kind === "assetDebt" && r.assetNames.length > 0 ? (
                              r.assetNames.join("・")
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                            {yen(r.amount)}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {r.kind === "calendar" && !locked && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm(`「${r.description}」を削除してよいですか？`))
                                    return;
                                  await fetch(`/api/budget-items/${r.id}`, { method: "DELETE" });
                                  for (const key of ["budgets", "budget-items", "budget-history"])
                                    qc.invalidateQueries({ queryKey: [key] });
                                }}
                                className="text-xs text-slate-300 hover:text-red-500"
                                aria-label={`${r.description} を削除`}
                                title="削除"
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Modal>
          );
        })()}
    </AppShell>
  );
}
