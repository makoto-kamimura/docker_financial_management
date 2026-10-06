"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AccountFlowDiagram, type FlowGraph } from "@/components/AccountFlowDiagram";
import { BankTransactionsPanel } from "@/components/BankTransactionsPanel";
import { FundingPlanPanel } from "@/components/FundingPlanPanel";
import { RecurringSuggestionsPanel } from "@/components/RecurringSuggestionsPanel";
import { filterFlowGraph } from "@/lib/flow-graph";
import { CashFlowTrendCharts } from "@/components/CashFlowTrendCharts";
import { BankTransactionsCalendar } from "@/components/BankTransactionsCalendar";
import { SectionLead } from "@/components/Explain";
import { BANK_HELP } from "@/lib/help-texts";
import { BANK_ACCOUNT_TYPE_LABEL as TYPE_LABEL } from "@/lib/labels";
import { YearBadge } from "@/components/YearBadge";
import { useFiscalYear } from "@/lib/use-fiscal-year";
import { PageHeader, SegmentedControl, Tabs } from "@/components/ui";

type BankAccount = {
  id: number;
  name: string;
  bankName: string;
  branchName: string | null;
  accountType: string;
  accountNumber: string | null;
  lastFour?: string | null;
  note?: string | null;
  account?: { id: number; code: string; name: string } | null;
  /** 明細合計 + 差額（lib/bank-balance.ts の定義） */
  balance: number;
  /** 明細の増減合計だけの残高（差額入力の案内に使う） */
  transactionSum?: number;
  /** 明細に現れない差額（期首残高相当）。編集画面で入力する */
  balanceAdjustment?: number;
  /** 差額を確かめて保存した日時（0 円のままでも）。あれば「差額を入力」の案内を出さない */
  balanceCheckedAt?: string | null;
  /** 明細を最後に登録した日時（CSV 取込・手入力）。明細が無ければ口座の登録日時 */
  lastUpdatedAt?: string | null;
  /** 明細上の最新の取引日 */
  lastTransactionDate?: string | null;
  _count: { transactions: number };
};
type FlowTransferRow = {
  id: number;
  from: string | null;
  to: string | null;
  amount: number;
  kind: string;
  channel: string;
  channelLabel: string;
  label: string | null;
  day: number;
  note: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
};
type FlowResponse = { cyclic: boolean; graph: FlowGraph; transfers: FlowTransferRow[] };
type MonthlyCashFlowResponse = {
  year: number;
  month: number;
  graph: FlowGraph;
  /** 推測で補ったフローの本数と、推測に使った過去の月数 */
  estimatedCount?: number;
  historyMonths?: number;
};

const yen = (v: number) => (v ?? 0).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
// 最終更新日時（明細を最後に登録した日時）の表示。分まで出す
const dateTimeLabel = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const dateLabel = (v?: string | null) =>
  v
    ? new Date(v).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "—";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const now = new Date();
const EMPTY_FLOW: FlowResponse = { cyclic: false, graph: { nodes: [], links: [] }, transfers: [] };

// 銀行まわりの機能はこのページに集約する（入出金管理・残高シミュレーションを統合）。
// 既定の「キャッシュフロー」タブは資産管理・借入金管理と同じ並びで、残高の推移 → 資金繰り →
// 毎月の入出金（資金移動）→ 資金フロー図 → 銀行口座（登録・編集・差額）の順に置く。
// 口座残高のサマリはダッシュボードへ移した。手入力の明細の登録は「カレンダー」タブで行う。
const TABS = [
  ["cashflow", "キャッシュフロー"],
  ["list", "一覧"],
  ["calendar", "カレンダー"],
  ["csv", "CSV インポート"],
] as const;
type Tab = (typeof TABS)[number][0];

// キャッシュフロータブの「資金移動スケジュール」の表示モード。
// 一覧＝登録済みの資金移動ルールを表で見る／スケジュール＝月次カレンダーで予定日を見る。
const SCHEDULE_MODES = [
  ["list", "一覧モード"],
  ["calendar", "スケジュールモード"],
] as const;
type ScheduleMode = (typeof SCHEDULE_MODES)[number][0];

// 口座の新規登録フォーム（設定「口座・カード管理」から移設）
type NewAccountForm = {
  name: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  lastFour: string;
  accountCode: string;
  note: string;
};
const BLANK_ACCOUNT: NewAccountForm = {
  name: "",
  bankName: "",
  branchName: "",
  accountType: "ORDINARY",
  accountNumber: "",
  lastFour: "",
  accountCode: "",
  note: "",
};
type AccountRef = { id: number; code: string; name: string; category: string };

// 既存口座の編集フォーム（設定「口座・カード管理」から移設）
type EditAccountForm = {
  id: number;
  name: string;
  bankName: string;
  lastFour: string;
  accountCode: string;
  note: string;
  /** 明細合計と実際の残高との差額（円。文字列で保持して空欄も許す） */
  balanceAdjustment: string;
  /** 表示用: 明細の増減合計 */
  transactionSum: number;
};

// ─── Page ────────────────────────────────────────────────────────────────────

function BankAccountsContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "";
  const initialTab = (TABS.map(([t]) => t) as readonly string[]).includes(tabParam)
    ? (tabParam as Tab)
    : // 旧タブ（サマリ / 振替 / 残高シミュレーション / 入出金）へのリンクは統合先へ寄せる
      tabParam === "transactions"
      ? "list"
      : "cashflow";
  const [tab, setTab] = useState<Tab>(initialTab);
  // 「表示する銀行」カードで選んだ口座の id。null はすべての銀行（既定）
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState<NewAccountForm>(BLANK_ACCOUNT);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState<EditAccountForm | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });

  // 選んだ口座（削除などで見つからなくなったら、すべての銀行として扱う）
  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const shownAccounts = selected ? [selected] : accounts;
  // 「表示する銀行」カードと銀行口座カードに出す残高合計（選んだ範囲）
  const totalBalance = shownAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  // 資金フロー図（入出金管理から移設）: 設定ベース（既定）/ 実績ベース（月次・F-6）
  const [flowSource, setFlowSource] = useState<"config" | "actual">("config");
  // 年は左のメニューの対象年度（全画面で共通）。ここでは月だけを選ぶ
  const flowYear = useFiscalYear();
  const [flowMonth, setFlowMonth] = useState(now.getMonth() + 1);
  // 資金移動スケジュールの表示モードと、振替登録モーダルの開閉
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("list");
  const [showBankTransferForm, setShowBankTransferForm] = useState(false);

  const { data: flow } = useQuery({
    queryKey: ["transfer-flow"],
    queryFn: async (): Promise<FlowResponse> => {
      const res = await fetch("/api/transfers/flow");
      if (!res.ok) return EMPTY_FLOW;
      return res.json();
    },
  });

  const { data: monthlyFlow, isLoading: monthlyFlowLoading } = useQuery({
    queryKey: ["cashflow-monthly", flowYear, flowMonth],
    enabled: flowSource === "actual",
    queryFn: async (): Promise<MonthlyCashFlowResponse> => {
      const res = await fetch(`/api/cashflow/monthly?year=${flowYear}&month=${flowMonth}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  // 紐付き勘定科目の選択肢（設定の登録フォームと同じく資産・負債のみ）
  const { data: accountRefs = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const assetAccounts = accountRefs.filter(
    (a) => a.category === "ASSET" || a.category === "LIABILITY",
  );

  const saveAccount = async () => {
    setAccountError(null);
    const body: Record<string, string> = {
      name: accountForm.name,
      bankName: accountForm.bankName,
      accountType: accountForm.accountType,
    };
    for (const k of ["branchName", "accountNumber", "lastFour", "accountCode", "note"] as const) {
      if (accountForm[k]) body[k] = accountForm[k];
    }
    const r = await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setShowAccountForm(false);
      setAccountForm(BLANK_ACCOUNT);
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    } else {
      const j = await r.json().catch(() => null);
      setAccountError(j?.error ?? "口座の登録に失敗しました");
    }
  };

  // 既存口座の編集・削除（設定「口座・カード管理」から移設）
  const saveEditAccount = async () => {
    if (!editAccount) return;
    setAccountError(null);
    const r = await fetch(`/api/bank-accounts/${editAccount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editAccount.name,
        bankName: editAccount.bankName,
        lastFour: editAccount.lastFour,
        accountCode: editAccount.accountCode,
        note: editAccount.note,
        // 空欄は差額なし（0）として送る
        balanceAdjustment: Number(editAccount.balanceAdjustment || 0),
      }),
    });
    if (r.ok) {
      setEditAccount(null);
      // 差額は残高の定義に含まれるため、残高を使う表示をまとめて取り直す
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
      qc.invalidateQueries({ queryKey: ["cash-outlook"] });
    } else {
      const j = await r.json().catch(() => null);
      setAccountError(j?.error ?? "口座の更新に失敗しました");
    }
  };

  const deleteAccount = async (a: BankAccount) => {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const r = await fetch(`/api/bank-accounts/${a.id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      alert(j?.error ?? `削除に失敗しました。(HTTP ${r.status})`);
      return;
    }
    if (selectedId === a.id) setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
  };

  // 資金移動スケジュールの一覧と資金フロー図は、選んだ口座が関わるものだけにする
  const shownTransfers = (flow?.transfers ?? []).filter(
    (t) => !selected || t.fromAccountId === selected.id || t.toAccountId === selected.id,
  );
  const shownGraph = (graph: FlowGraph) =>
    selected ? filterFlowGraph(graph, selected.name) : graph;

  // 資金フロー図のベース切替（設定／実績）。どちらのカードにも同じものを出す
  const flowSourceToggle = (
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
  );

  return (
    <AppShell>
      <PageHeader title="銀行管理" lead={BANK_HELP.page} />

      {/* ── 表示する銀行（全タブ共通。指定なしはすべての銀行をまとめて表示する）── */}
      <div className="card mb-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor="bank-selector" className="text-sm font-semibold text-slate-700">
            表示する銀行
          </label>
          <select
            id="bank-selector"
            className="input-field w-64"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">すべての銀行</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.bankName}）
              </option>
            ))}
          </select>
          {accounts.length > 0 && (
            <span className="text-xs text-slate-500">
              残高 <span className="font-medium text-slate-700">{yen(totalBalance)}</span> ・{" "}
              {shownAccounts.length} 口座
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">{BANK_HELP.selector}</p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "cashflow" && (
        <>
          {/* ── 残高の推移（借入金管理の「借入残高の推移」と同じ形。先は予算と実績から見込む）── */}
          <CashFlowTrendCharts year={flowYear} month={flowMonth} accountId={selectedId} />

          {/* ── 資金繰り（必要残高と入金期限）──────────────────────
              現在残高と資金移動の設定から、選んだ年月を起点に 3 か月分を自動で算出する。 */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="section-title">
              資金繰り（{flowYear}年{flowMonth}月から3か月）
            </h2>
            <p className="text-xs text-slate-500">{BANK_HELP.funding}</p>
            {/* 年月は資金繰りと実績ベースのフロー図の起点を兼ねる */}
            <span className="ml-auto">
              <YearBadge />
            </span>
            <select
              value={flowMonth}
              onChange={(e) => setFlowMonth(Number(e.target.value))}
              className="select-sm"
              aria-label="資金繰りの起点の月"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}月
                </option>
              ))}
            </select>
          </div>
          <FundingPlanPanel year={flowYear} month={flowMonth} months={3} accountId={selectedId} />

          {/* ── 毎月の入出金の候補（明細から見つけたもの。登録で資金移動ルールになる）── */}
          <RecurringSuggestionsPanel accountId={selectedId} />

          {/* ── 資金移動スケジュール ────────────────────────────
              一覧モード＝登録済みの資金移動ルールを表で見る。
              スケジュールモード＝口座ごとの予定日を月次カレンダーで見る（登録・削除もできる）。 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="section-title">資金移動スケジュール</h2>
            <SegmentedControl
              options={SCHEDULE_MODES}
              value={scheduleMode}
              onChange={setScheduleMode}
            />
            <button
              type="button"
              onClick={() => setShowBankTransferForm(true)}
              disabled={accounts.length < 2}
              className="btn-primary ml-auto"
              title={accounts.length < 2 ? "振替には 2 つ以上の口座の登録が必要です" : undefined}
            >
              振替を登録（銀行 → 銀行）
            </button>
          </div>
          {scheduleMode === "list" && <SectionLead>{BANK_HELP.schedule}</SectionLead>}

          {/* 一覧はフロー図のベース切替（設定／実績）に関係なく、登録済みのルールをそのまま並べる */}
          {scheduleMode === "list" && shownTransfers.length > 0 && (
            <div className="card mb-6">
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
                  {shownTransfers.map((t) => (
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

          {scheduleMode === "list" && flow && shownTransfers.length === 0 && (
            <p className="text-sm text-slate-500 mb-6">
              資金移動がまだ登録されていません。スケジュールモードのカレンダーから固定の入出金を登録すると、
              この一覧と上のフロー図に表示されます。
            </p>
          )}

          {scheduleMode === "calendar" && (
            // 実績（明細）と取り違えないよう、更新されるのは毎月のルールだけだと明示する
            <SectionLead>
              {BANK_HELP.scheduleCalendar}
              上の「表示する銀行」を「すべての銀行」にすると、全口座の予定をまとめて見られます。
            </SectionLead>
          )}

          {/* カレンダー（スケジュールモードのみ）と、取込済み明細の振替紐付け。
              振替を登録するモーダルは上のボタンから開く（パネル側が中身を持つ）。 */}
          <BankTransactionsPanel
            view="recurring"
            recurringParts={
              scheduleMode === "calendar"
                ? ["register", "calendar", "match"]
                : ["register", "match"]
            }
            bankTransferOpen={showBankTransferForm}
            onBankTransferOpenChange={setShowBankTransferForm}
            accountId={selected?.id ?? null}
          />

          {/* ── 口座間 資金フロー図（設定ベース／実績ベース）── */}
          {flowSource === "config" ? (
            <div className="card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h3 className="section-title">口座間 資金フロー図</h3>
                {flowSourceToggle}
              </div>
              <SectionLead className="mb-4">{BANK_HELP.flow}</SectionLead>
              {!flow ? (
                <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                  読み込み中…
                </div>
              ) : flow.cyclic ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  資金移動に循環があるためフロー図を描画できません。下のスケジュールで経路を見直してください。
                </p>
              ) : (
                <AccountFlowDiagram data={shownGraph(flow.graph)} />
              )}
            </div>
          ) : (
            <div className="card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h3 className="section-title">
                  {flowYear}年{flowMonth}月 実績フロー図（月は資金繰りの選択）
                </h3>
                {flowSourceToggle}
              </div>
              <SectionLead>{BANK_HELP.monthlyFlow}</SectionLead>
              {monthlyFlowLoading || !monthlyFlow ? (
                <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                  読み込み中…
                </div>
              ) : shownGraph(monthlyFlow.graph).links.length === 0 ? (
                <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                  対象月に科目紐付け済みの明細がありません。「一覧」タブで紐付けを行ってください。
                </p>
              ) : (
                <AccountFlowDiagram data={shownGraph(monthlyFlow.graph)} />
              )}
            </div>
          )}

          {/* ── 銀行口座（資産管理の「実物資産」・借入金管理の「借入金」と同じく 1 枚のカードにまとめる）──
              「明細を見る」で、その口座の明細を一覧タブで開く。 */}
          <div className="card mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="section-title mb-1">銀行口座</h2>
                {/* 残高の定義と、実残高と差異があるときの対処（差額入力）を案内する */}
                <SectionLead className="mb-1">{BANK_HELP.balance}</SectionLead>
                {accounts.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    残高合計: {yen(totalBalance)} ・ {shownAccounts.length} 口座
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setAccountError(null);
                  setShowAccountForm(true);
                }}
                className="btn-primary shrink-0"
              >
                銀行追加
              </button>
            </div>
            {isLoading ? (
              <p className="text-slate-400 text-sm">読み込み中…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-slate-500">
                口座が登録されていません。右上の「銀行追加」から追加してください。
              </p>
            ) : (
              <div className="space-y-2">
                {shownAccounts.map((a) => (
                  <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {TYPE_LABEL[a.accountType] ?? a.accountType}
                          </span>
                          <h3 className="font-medium text-slate-800 text-sm">{a.name}</h3>
                          <span className="text-xs text-slate-500">
                            {a.bankName}
                            {a.branchName ? " " + a.branchName : ""}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {a._count.transactions}件の取引
                          {a._count.transactions > 0 && (
                            <> ・ 最新 {dateLabel(a.lastTransactionDate)}</>
                          )}{" "}
                          {/* 口座ごとの最終更新日時（この口座の明細を最後に登録した日時） */}・
                          最終更新 {dateTimeLabel(a.lastUpdatedAt)}
                        </div>
                        {/* 差額を入れている口座はその内訳を明示する。差額 0 円を確かめて保存した口座は
                            「明細合計どおり」と出し、まだ確かめていない口座にだけ案内を出す */}
                        {a.balanceAdjustment ? (
                          <div className="text-xs text-slate-500 mt-0.5">
                            明細合計 {yen(a.transactionSum ?? 0)} ＋ 差額 {yen(a.balanceAdjustment)}
                          </div>
                        ) : a.balanceCheckedAt ? (
                          <div className="text-xs text-slate-400 mt-0.5">
                            明細合計どおり（差額なし）
                          </div>
                        ) : (
                          a._count.transactions > 0 && (
                            <div className="text-xs text-amber-600 mt-0.5">
                              実際の残高と違う場合は「編集」から差額を入力
                            </div>
                          )
                        )}
                        {a.account && (
                          <div className="text-xs text-indigo-600 mt-0.5">
                            紐付く科目: {a.account.code} {a.account.name}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">残高</p>
                          <p className="font-bold text-indigo-600 text-sm tabular-nums">
                            {yen(a.balance ?? 0)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {/* 一覧タブで、この口座の明細を開く */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(a.id);
                              setTab("list");
                            }}
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                          >
                            明細を見る
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAccountError(null);
                              setEditAccount({
                                id: a.id,
                                name: a.name,
                                bankName: a.bankName,
                                lastFour: a.lastFour ?? "",
                                accountCode: a.account?.code ?? "",
                                note: a.note ?? "",
                                balanceAdjustment: a.balanceAdjustment
                                  ? String(a.balanceAdjustment)
                                  : "",
                                transactionSum: a.transactionSum ?? 0,
                              });
                            }}
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAccount(a)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 一覧 / CSV ──────────── */}
      {(tab === "list" || tab === "csv") && (
        <BankTransactionsPanel
          view={tab}
          // 一覧から予定のカレンダーを開くと、キャッシュフロータブの資金移動スケジュールへ移る
          onViewChange={(v) => setTab(v === "recurring" ? "cashflow" : v)}
          accountId={selected?.id ?? null}
        />
      )}

      {/* ── カレンダー（日ごとの明細と、手入力での登録）──────────── */}
      {tab === "calendar" && <BankTransactionsCalendar accountId={selected?.id ?? null} />}

      {/* 口座登録モーダル（設定「口座・カード管理」の新規登録から移設）*/}
      {showAccountForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-1">銀行追加</h2>
            <p className="text-xs text-slate-500 mb-4">
              クレジットカード・電子マネーの登録は「カード・電子マネー管理」で行います。
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">名称 *</label>
                <input
                  placeholder="例: 住信SBI普通"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">金融機関 *</label>
                <input
                  placeholder="例: 住信SBIネット銀行"
                  value={accountForm.bankName}
                  onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">支店名</label>
                  <input
                    value={accountForm.branchName}
                    onChange={(e) => setAccountForm((f) => ({ ...f, branchName: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">口座種別</label>
                  <select
                    value={accountForm.accountType}
                    onChange={(e) => setAccountForm((f) => ({ ...f, accountType: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Object.entries(TYPE_LABEL).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">口座番号</label>
                  <input
                    value={accountForm.accountNumber}
                    onChange={(e) =>
                      setAccountForm((f) => ({ ...f, accountNumber: e.target.value }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">下4桁</label>
                  <input
                    placeholder="1234"
                    maxLength={4}
                    value={accountForm.lastFour}
                    onChange={(e) => setAccountForm((f) => ({ ...f, lastFour: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  紐付き勘定科目
                </label>
                <select
                  value={accountForm.accountCode}
                  onChange={(e) => setAccountForm((f) => ({ ...f, accountCode: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {assetAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">メモ</label>
                <input
                  placeholder="任意"
                  value={accountForm.note}
                  onChange={(e) => setAccountForm((f) => ({ ...f, note: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {accountError && <p className="text-xs text-red-600">{accountError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowAccountForm(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveAccount}
                disabled={!accountForm.name || !accountForm.bankName}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 口座編集モーダル（設定「口座・カード管理」から移設）*/}
      {editAccount && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">銀行口座を編集</h2>
            <div className="space-y-3">
              {(
                [
                  ["name", "名称", "例: 住信SBI普通"],
                  ["bankName", "金融機関", "例: 住信SBIネット銀行"],
                  ["lastFour", "下4桁", "1234"],
                  ["note", "メモ", "任意"],
                ] as ["name" | "bankName" | "lastFour" | "note", string, string][]
              ).map(([k, label, placeholder]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    placeholder={placeholder}
                    maxLength={k === "lastFour" ? 4 : undefined}
                    value={editAccount[k]}
                    onChange={(e) => setEditAccount({ ...editAccount, [k]: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}

              {/* 残高の差額。明細に現れない期首残高などを吸収し、サマリの残高に加算される */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  残高の差額（円）
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  取得できる明細を登録したのに現在の残高と差異がある場合は、差額を入力してください。
                  取込開始前から口座にあった残高（期首残高）などが該当します。
                </p>
                <input
                  type="number"
                  placeholder="例: 554929"
                  value={editAccount.balanceAdjustment}
                  onChange={(e) =>
                    setEditAccount({ ...editAccount, balanceAdjustment: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-500 mt-2">
                  明細合計 {yen(editAccount.transactionSum)} ＋ 差額{" "}
                  {yen(Number(editAccount.balanceAdjustment || 0))} ＝{" "}
                  <span className="font-semibold text-indigo-600">
                    {yen(editAccount.transactionSum + Number(editAccount.balanceAdjustment || 0))}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  紐付き勘定科目
                </label>
                <select
                  value={editAccount.accountCode}
                  onChange={(e) => setEditAccount({ ...editAccount, accountCode: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {assetAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {accountError && <p className="text-xs text-red-600">{accountError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditAccount(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveEditAccount}
                disabled={!editAccount.name || !editAccount.bankName}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function BankAccountsPage() {
  return (
    <Suspense>
      <BankAccountsContent />
    </Suspense>
  );
}
