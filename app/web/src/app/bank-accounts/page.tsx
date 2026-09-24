"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { HelpCircle, Pencil, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AccountFlowDiagram, type FlowGraph } from "@/components/AccountFlowDiagram";
import { BankTransactionsPanel } from "@/components/BankTransactionsPanel";
import { FundingPlanPanel } from "@/components/FundingPlanPanel";
import {
  BalanceTrendChart,
  type TrendAccount,
  type TrendGranularity,
  type TrendPoint,
} from "@/components/BalanceTrendChart";
import { BANK_ACCOUNT_TYPE_LABEL as TYPE_LABEL } from "@/lib/labels";

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
// 口座サマリ・残高推移・資金繰りは既定表示の「サマリ」タブにまとめ、
// 口座間のお金の移動（フロー図・スケジュール・振替の登録と紐付け）は「振替」タブに集約する。
// 残高シミュレーションはサマリの資金繰りへ作り替えた（旧 ?tab=simulation / ?tab=accounts も寄せる）。
const TABS = [
  ["summary", "サマリ"],
  ["list", "明細一覧"],
  ["csv", "CSV インポート"],
  ["flow", "振替"],
] as const;
type Tab = (typeof TABS)[number][0];

// 振替タブの「資金移動スケジュール」の表示モード。
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

// 口座サマリの残高の説明（差額入力の案内）
const BALANCE_HELP_TEXT =
  "残高は「取り込んだ明細の増減合計 + 差額」で表示しています。" +
  "取得できる明細をすべて登録したのに実際の残高と差異がある場合は、" +
  "取込開始前から口座にあった残高（期首残高）などが含まれていないためです。" +
  "口座カードの編集（鉛筆アイコン）から差額を入力してください。" +
  "差額は総資産サマリ・資金繰り・残高推移グラフにも反映されます。";

// ─── Page ────────────────────────────────────────────────────────────────────

function BankAccountsContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "";
  const initialTab = (TABS.map(([t]) => t) as readonly string[]).includes(tabParam)
    ? (tabParam as Tab)
    : // 旧タブ（残高シミュレーション / 口座 / 入出金 / カレンダー）へのリンクは統合先へ寄せる
      tabParam === "simulation" || tabParam === "recurring"
      ? "flow"
      : tabParam === "transactions"
        ? "list"
        : "summary";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<BankAccount | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState<NewAccountForm>(BLANK_ACCOUNT);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState<EditAccountForm | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });

  // 口座サマリ（画面上部に常時表示）の集計値
  const totalBalance = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  const totalTxCount = accounts.reduce((s, a) => s + (a._count?.transactions ?? 0), 0);
  // 全口座を通じて最後に明細を登録した日時（サマリの「最終更新」）
  const lastUpdatedAt = accounts.reduce<string | null>(
    (latest, a) =>
      a.lastUpdatedAt && (!latest || a.lastUpdatedAt > latest) ? a.lastUpdatedAt : latest,
    null,
  );

  // 資金フロー図（入出金管理から移設）: 設定ベース（既定）/ 実績ベース（月次・F-6）
  const [flowSource, setFlowSource] = useState<"config" | "actual">("config");
  const [flowYear, setFlowYear] = useState(now.getFullYear());
  const [flowMonth, setFlowMonth] = useState(now.getMonth() + 1);
  // 振替タブ: 資金移動スケジュールの表示モードと、振替登録モーダルの開閉
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

  // 残高推移（対象年月の前後 6 か月。将来分は資金移動ルールからの推測）。
  // 月次は月末残高、日次は月の途中の上下（給与の入金前後・引き落とし日）まで見える
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>("month");
  const { data: trend } = useQuery({
    queryKey: ["balance-trend", flowYear, flowMonth, trendGranularity],
    enabled: tab === "summary",
    queryFn: async (): Promise<{ accounts: TrendAccount[]; points: TrendPoint[] }> => {
      const res = await fetch(
        `/api/bank-accounts/balance-trend?year=${flowYear}&month=${flowMonth}&before=6&after=6&granularity=${trendGranularity}`,
      );
      if (!res.ok) return { accounts: [], points: [] };
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
      qc.invalidateQueries({ queryKey: ["balance-trend"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
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
    if (selected?.id === a.id) setSelected(null);
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
  };

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="page-title">銀行管理</h1>
      </div>

      {/* タブ（口座サマリと資金移動フロー図は「サマリ」タブにまとめた） */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {TABS.map(([t, label]) => (
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

      {/* 口座サマリ（サマリタブ） */}
      {tab === "summary" && (
        <div className="card mb-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h2 className="section-title">口座サマリ</h2>
            {/* 残高の定義と、実残高と差異があるときの対処（差額入力）を案内する */}
            <span className="relative inline-flex items-center group">
              <HelpCircle
                className="w-4 h-4 text-slate-400 cursor-help"
                aria-label="残高の計算方法について"
              />
              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-80 rounded-md bg-slate-800 px-2.5 py-2 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover:block">
                {BALANCE_HELP_TEXT}
              </span>
            </span>
            <p className="text-xs text-slate-400">登録口座の残高合計</p>
            <button
              onClick={() => {
                setAccountError(null);
                setShowAccountForm(true);
              }}
              className="btn-primary px-4 py-2 text-sm ml-auto"
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
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">総残高</p>
                  <p className="text-2xl font-bold text-indigo-600">
                    ¥{totalBalance.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">口座数</p>
                  <p className="text-2xl font-bold text-slate-700">{accounts.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">取引件数</p>
                  <p className="text-2xl font-bold text-slate-700">{totalTxCount}</p>
                </div>
                {/* 明細を最後に登録した日時（どの口座も含めた最新）。取込の鮮度の目安 */}
                <div>
                  <p className="text-xs text-slate-500 mb-1">最終更新</p>
                  <p className="text-base font-bold text-slate-700 leading-tight pt-1.5">
                    {dateTimeLabel(lastUpdatedAt)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">明細を最後に登録した日時</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    className={`group relative rounded-xl border transition-all ${selected?.id === a.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`}
                  >
                    <button onClick={() => setSelected(a)} className="w-full p-4 text-left">
                      <div className="text-xs text-slate-500 mb-1">
                        {a.bankName}
                        {a.branchName ? " " + a.branchName : ""} /{" "}
                        {TYPE_LABEL[a.accountType] ?? a.accountType}
                      </div>
                      <div className="font-semibold text-slate-800">{a.name}</div>
                      <div className="text-lg font-bold text-indigo-600 mt-1">
                        ¥{(a.balance ?? 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {a._count.transactions}件の取引
                        {a._count.transactions > 0 && (
                          <> / 最新 {dateLabel(a.lastTransactionDate)}</>
                        )}
                      </div>
                      {/* 口座ごとの最終更新日時（この口座の明細を最後に登録した日時） */}
                      <div className="text-xs text-slate-400">
                        最終更新 {dateTimeLabel(a.lastUpdatedAt)}
                      </div>
                      {/* 差額を入れている口座はその内訳を明示する。未入力の口座には案内を出す */}
                      {a.balanceAdjustment ? (
                        <div className="text-xs text-slate-400 mt-0.5">
                          明細合計 ¥{(a.transactionSum ?? 0).toLocaleString()} ＋ 差額 ¥
                          {a.balanceAdjustment.toLocaleString()}
                        </div>
                      ) : (
                        a._count.transactions > 0 && (
                          <div className="text-xs text-amber-600 mt-0.5">
                            実際の残高と違う場合は編集から差額を入力
                          </div>
                        )
                      )}
                      {a.account && (
                        <div className="text-xs text-indigo-600 mt-1">
                          → {a.account.code} {a.account.name}
                        </div>
                      )}
                    </button>
                    {/* 編集・削除（設定「口座・カード管理」から移設） */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        aria-label={`${a.name} を編集`}
                        title="編集"
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
                        className="text-slate-300 hover:text-indigo-500"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${a.name} を削除`}
                        title="削除"
                        onClick={() => deleteAccount(a)}
                        className="text-slate-300 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 表示条件（サマリ／振替タブで共有）────────────────────────
          ベース切替はフロー図（振替タブ）にだけ効くので、サマリでは出さない。
          年月は残高推移・資金繰り（サマリ）とフロー図（振替）の起点を兼ねるため両方で出す。 */}
      {(tab === "summary" || tab === "flow") && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="section-title">{tab === "flow" ? "振替" : "表示対象"}</h2>
          {tab === "flow" && (
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-sm h-9 ml-auto">
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
          )}
          {/* 年月はフロー図（実績ベース）と残高推移・資金繰りの起点を兼ねる */}
          <select
            value={flowYear}
            onChange={(e) => setFlowYear(Number(e.target.value))}
            className={`text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white ${tab === "summary" ? "ml-auto" : ""}`}
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
        </div>
      )}

      {/* ── 残高推移（サマリタブ）────────────────────────────────
          上で選んだ対象年月の前後 6 か月。実績のある月は実線、以降は
          資金移動ルールの月次純増減から推測した破線で表示する。 */}
      {tab === "summary" && (
        <div className="card mb-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
            <h3 className="section-title">残高推移</h3>
            <p className="text-xs text-slate-400">
              {flowYear}年{flowMonth}月の前後6か月。実線＝実績、破線＝資金移動の設定からの推測。
              {trendGranularity === "day" && "日次は各日の残高。"}
            </p>
            {/* 月末残高だけでは月の途中の上下（給与の入金前後・引き落とし日）が潰れるため日次に切り替えられる */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5 ml-auto">
              {(["month", "day"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setTrendGranularity(g)}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                    trendGranularity === g
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {g === "month" ? "月次" : "日次"}
                </button>
              ))}
            </div>
          </div>
          {!trend ? (
            <div className="flex items-center justify-center h-48 text-sm text-slate-400">
              読み込み中…
            </div>
          ) : trend.accounts.length === 0 ? (
            <p className="text-sm text-slate-500">
              口座が登録されていません。上の「銀行追加」から追加してください。
            </p>
          ) : (
            <BalanceTrendChart
              points={trend.points}
              accounts={trend.accounts}
              targetMonth={`${flowYear}-${String(flowMonth).padStart(2, "0")}`}
              granularity={trendGranularity}
            />
          )}
        </div>
      )}

      {/* ── 資金繰り（必要残高と入金期限）──────────────────────
          現在残高と資金移動の設定から、上で選んだ年月を起点に 3 か月分を自動で算出する。
          口座サマリ・フロー図と並べて一目で把握できるよう「サマリ」タブへ集約した。 */}
      {tab === "summary" && (
        <>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <h2 className="section-title">
              資金繰り（{flowYear}年{flowMonth}月から3か月）
            </h2>
            <p className="text-xs text-slate-400">
              引き落としに間に合わせるための預け入れ期限と必要額を表示します。
            </p>
          </div>
          <FundingPlanPanel year={flowYear} month={flowMonth} months={3} />
        </>
      )}

      {/* ── 明細一覧 / CSV（カレンダーは「資金移動」タブへ移設した）──────────── */}
      {(tab === "list" || tab === "csv") && (
        <BankTransactionsPanel
          view={tab}
          // カレンダーは資金移動タブへ移したため、ここでの遷移先は明細一覧と CSV のみ
          onViewChange={(v) => setTab(v === "recurring" ? "flow" : v)}
          accountId={selected?.id ?? null}
          onAccountIdChange={(id) => setSelected(accounts.find((a) => a.id === id) ?? null)}
        />
      )}

      {/* ── 振替タブ ────────────────────────────────────────────
          口座間 資金フロー図 → 資金移動スケジュール → 取込済み明細の振替紐付け の順で並べる。
          都度の振替（銀行 → 銀行）の登録はスケジュール見出しの右端のボタンからモーダルで行う。 */}
      {tab === "flow" &&
        (flowSource === "config" ? (
          <div className="card mb-6">
            <h3 className="section-title mb-4">口座間 資金フロー図</h3>
            {!flow ? (
              <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                読み込み中…
              </div>
            ) : flow.cyclic ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                資金移動に循環があるためフロー図を描画できません。下のスケジュールで経路を見直してください。
              </p>
            ) : (
              <AccountFlowDiagram data={flow.graph} />
            )}
          </div>
        ) : (
          <div className="card mb-6">
            <h3 className="section-title mb-4">
              {flowYear}年{flowMonth}月 実績フロー図
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              科目に紐付け済み（「明細一覧」タブで紐付け）の入出金明細と資金移動ルールから生成しています。
              対象月の実績がまだ無い項目は、直近 {monthlyFlow?.historyMonths ?? 3}{" "}
              か月の平均から推測した金額を破線（アンバー）で表示します。
            </p>
            {monthlyFlowLoading || !monthlyFlow ? (
              <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                読み込み中…
              </div>
            ) : monthlyFlow.graph.links.length === 0 ? (
              <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                対象月に科目紐付け済みの明細がありません。「明細一覧」タブで紐付けを行ってください。
              </p>
            ) : (
              <AccountFlowDiagram data={monthlyFlow.graph} />
            )}
          </div>
        ))}

      {tab === "flow" && (
        <>
          {/* ── 資金移動スケジュール ────────────────────────────
              一覧モード＝登録済みの資金移動ルールを表で見る。
              スケジュールモード＝口座ごとの予定日を月次カレンダーで見る（登録・削除もできる）。 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="section-title">資金移動スケジュール</h2>
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
              {SCHEDULE_MODES.map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScheduleMode(m)}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                    scheduleMode === m
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowBankTransferForm(true)}
              disabled={accounts.length < 2}
              className="btn-primary px-4 py-2 text-sm ml-auto disabled:opacity-40"
              title={accounts.length < 2 ? "振替には 2 つ以上の口座の登録が必要です" : undefined}
            >
              振替を登録（銀行 → 銀行）
            </button>
          </div>

          {/* 一覧はフロー図のベース切替（設定／実績）に関係なく、登録済みのルールをそのまま並べる */}
          {scheduleMode === "list" && flow && flow.transfers.length > 0 && (
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
                  {flow.transfers.map((t) => (
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

          {scheduleMode === "list" && flow && flow.transfers.length === 0 && (
            <p className="text-sm text-slate-500 mb-6">
              資金移動がまだ登録されていません。スケジュールモードのカレンダーから固定の入出金を登録すると、
              この一覧と上のフロー図に表示されます。
            </p>
          )}

          {scheduleMode === "calendar" && (
            <p className="text-xs text-slate-400 mb-2">
              毎月の引き落とし・入金の予定日を確認し、日付をクリックして追加・削除できます。
              対象口座は「すべての銀行」で全口座を俯瞰できます。
              {/* 実績（明細）と取り違えないよう、更新されるのは毎月のルールだけだと明示する */}
              <br />
              ここで追加・削除できるのは固定入出金（毎月の資金移動ルール）の情報のみで、
              取り込み済みの明細や口座残高は変わりません。実際の入出金の記録は「明細一覧」タブで行います。
            </p>
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
            onAccountIdChange={(id) => setSelected(accounts.find((a) => a.id === id) ?? null)}
          />
        </>
      )}

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
