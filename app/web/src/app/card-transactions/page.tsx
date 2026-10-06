"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { InfoNote, SectionLead } from "@/components/Explain";
import { CARD_HELP, cardFlowHelp } from "@/lib/help-texts";
import { AccountFlowDiagram, type FlowGraph } from "@/components/AccountFlowDiagram";
import {
  LINKED_ACCOUNT_TYPES,
  LINKED_ACCOUNT_TYPE_LABELS,
  isChargeableType,
  type LinkedAccountType,
} from "@/lib/linked-account-type";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";
import { CsvDropzone, Notice, PageHeader, SegmentedControl, Tabs } from "@/components/ui";

// ── 型 ──────────────────────────────────────────────────────────
type CardAccount = {
  id: number;
  name: string;
  /** クレジット / デビット / プリペイド / 電子マネー（lib/linked-account-type.ts） */
  type: LinkedAccountType;
  institution: string;
  lastFour: string | null;
  note?: string | null;
  account?: { id: number; code: string; name: string } | null;
  /** このカードをチャージ先に指定している明細の件数（カード明細 ＋ 銀行明細） */
  chargeSourceCount?: number;
};
// カード・電子マネー台帳の登録／編集フォーム（設定「口座・カード管理」から移設）
type CardForm = {
  /** 新規登録は null、編集は対象 id */
  id: number | null;
  name: string;
  type: LinkedAccountType;
  institution: string;
  lastFour: string;
  accountCode: string;
  note: string;
};
const BLANK_CARD: CardForm = {
  id: null,
  name: "",
  type: "CREDIT_CARD",
  institution: "",
  lastFour: "",
  accountCode: "",
  note: "",
};
type CategoryAccount = { id: number; code: string; name: string; category: string };
// チャージの自動判定ルール（card_transfer_rules）
type ImportResult = {
  inserted: number;
  /** 既に取り込み済みで重複していた行数 */
  skipped?: number;
  errors: { row: number; message: string }[];
};

// ── 定数 ────────────────────────────────────────────────────────
const now = new Date();
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 電子マネー・プリペイドはカード番号が無く、明細も「チャージ残高からの支払い」なので文言を切り替える
const ACCOUNT_TYPE_LABEL = LINKED_ACCOUNT_TYPE_LABELS;

// 明細一覧・カレンダーは実績管理の「履歴」「カレンダー」へ移した（components/CardTransactionsPanel.tsx）
type Tab = "summary" | "csv";

// サマリタブのフロー図（GET /api/linked-accounts/flow）。
// 引き落とし・チャージ・固定決済のどれにも現れないカードは線を引けないため unlinked として案内する。
type CardFlowResponse = {
  /** チャージがカード同士で循環していると描画できない（銀行側のフロー図と同じ扱い） */
  cyclic: boolean;
  graph: FlowGraph;
  /** チャージを月あたりに均すのに使った月数 */
  chargeMonths: number;
  unlinked: { id: number; name: string; type: string }[];
  /** 銀行口座 → カードの引き落とし（資金移動ルール）。スケジュール一覧の元データ */
  transfers: {
    id: number;
    from: string | null;
    linkedAccountId: number | null;
    linkedAccountName: string | null;
    amount: number;
    channel: string;
    channelLabel: string;
    label: string | null;
    day: number;
    note: string | null;
  }[];
  /** カードでの固定決済（CardRecurringPayment）。同じくスケジュール一覧の元データ */
  recurring: {
    id: number;
    accountId: number;
    accountName: string;
    label: string;
    amount: number;
    day: number;
  }[];
};
const EMPTY_CARD_FLOW: CardFlowResponse = {
  cyclic: false,
  graph: { nodes: [], links: [] },
  chargeMonths: 3,
  unlinked: [],
  transfers: [],
  recurring: [],
};

// サマリのスケジュールに並べる 1 件。引き落とし（銀行 → カード）と固定決済（カード → 外部）を
// 同じ形にそろえて、毎月の予定日で 1 つの表・カレンダーに混ぜて見せる
type CardScheduleEntry = {
  key: string;
  day: number;
  /** 対象のカード・電子マネー（絞り込みに使う。ルールにカードが無い場合は null） */
  accountId: number | null;
  from: string;
  to: string;
  amount: number;
  kindLabel: string;
  /** 引き落とし＝銀行から出る / 固定決済＝カードから出る。色分けに使う */
  kind: "debit" | "recurring";
};

// スケジュールの表示モード（銀行管理のキャッシュフロータブと同じ切替）
const CARD_SCHEDULE_MODES: [ScheduleMode, string][] = [
  ["list", "一覧モード"],
  ["calendar", "スケジュールモード"],
];
type ScheduleMode = "list" | "calendar";

// ── ページ ──────────────────────────────────────────────────────
// bank-transactions/page.tsx（銀行）と同構造。銀行管理のサマリタブに倣い、既定表示の
// 「サマリ」タブでカード・電子マネー関連の資金フロー図を示す。
// クレジット・デビット・プリペイド・電子マネー（Suica・PayPay 等）は明細の構造が同じなので
// 同じ画面で扱う。銀行口座を起点にする引き落としルールの登録は銀行管理側の役割で、
// この画面ではチャージ先の指定と、そのカードでの固定決済の登録だけを行う。
export default function CardTransactionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("summary");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // 取込先の取り違え防止。選択中のカードを確認してから取り込む（毎回表示する）
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // カード・電子マネー台帳の登録／編集モーダル（設定「口座・カード管理」から移設）
  const [cardForm, setCardForm] = useState<CardForm | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  // サマリタブのスケジュール（引き落とし・固定決済）の表示モードと対象カード
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("list");
  const [scheduleAccount, setScheduleAccount] = useState<number | "all">("all");

  // ── カレンダー ────────────────────────────────────────────────
  // カレンダーの年は対象年度（左のメニュー）に合わせる。月を送って年をまたいだら、対象年度も変える
  const viewYear = useFiscalYear();
  const setViewYear = (v: number | ((y: number) => number)) =>
    setFiscalYear(typeof v === "function" ? v(viewYear) : v);
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);

  // ── データ取得 ──────────────────────────────────────────────
  const { data: accounts } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<CardAccount[]> => {
      const list = ((await (await fetch("/api/linked-accounts")).json()).data ??
        []) as CardAccount[];
      if (list.length && accountId === null) setAccountId(list[0].id);
      return list;
    },
  });

  const { data: categoryAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // サマリタブのフロー図（銀行口座 → カード、カード → チャージ先、カード → 固定決済）
  const { data: cardFlow } = useQuery({
    queryKey: ["card-flow"],
    enabled: tab === "summary",
    queryFn: async (): Promise<CardFlowResponse> => {
      const res = await fetch("/api/linked-accounts/flow");
      if (!res.ok) return EMPTY_CARD_FLOW;
      return res.json();
    },
  });

  // 台帳（カード・電子マネー）に紐付ける科目。設定の登録フォームと同じく資産・負債のみ
  const ledgerAccounts = useMemo(
    () => (categoryAccounts ?? []).filter((a) => ["ASSET", "LIABILITY"].includes(a.category)),
    [categoryAccounts],
  );

  const selectedAccount = (accounts ?? []).find((a) => a.id === accountId) ?? null;
  const isEMoney = selectedAccount?.type === "E_MONEY";

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  // ── サマリのスケジュール（銀行管理のキャッシュフロータブと同じ並べ方）──────────────
  // 引き落とし（銀行 → カード）と固定決済（カード → 外部）はモデルが別だが、
  // どちらも「毎月◯日に決まった額が動く」ルールなので 1 つのスケジュールにまとめる
  const scheduleEntries = useMemo<CardScheduleEntry[]>(() => {
    const debits: CardScheduleEntry[] = (cardFlow?.transfers ?? []).map((t) => ({
      key: `transfer:${t.id}`,
      day: t.day,
      accountId: t.linkedAccountId,
      from: t.from ?? (t.label || "外部入金"),
      to: t.linkedAccountName ?? (t.label || "カード"),
      amount: t.amount,
      kindLabel: t.channelLabel,
      kind: "debit",
    }));
    const recurring: CardScheduleEntry[] = (cardFlow?.recurring ?? []).map((r) => ({
      key: `recurring:${r.id}`,
      day: r.day,
      accountId: r.accountId,
      from: r.accountName,
      to: r.label,
      amount: r.amount,
      kindLabel: "固定決済",
      kind: "recurring",
    }));
    return [...debits, ...recurring].sort((a, b) => a.day - b.day || a.key.localeCompare(b.key));
  }, [cardFlow]);

  // 対象カードでの絞り込み（"all" は全カード・電子マネーを俯瞰する。銀行の「すべての銀行」に相当）
  const filteredSchedule = useMemo(
    () =>
      scheduleAccount === "all"
        ? scheduleEntries
        : scheduleEntries.filter((e) => e.accountId === scheduleAccount),
    [scheduleEntries, scheduleAccount],
  );
  // スケジュールモードのカレンダー。予定日は「毎月◯日」なので、その月に無い日（31 日など）は
  // 月末に寄せる（引き落としの実務と同じ扱い）
  const scheduleByDay = useMemo(() => {
    const map = new Map<number, CardScheduleEntry[]>();
    for (const e of filteredSchedule) {
      const day = Math.min(e.day, daysInMonth);
      (map.get(day) ?? map.set(day, []).get(day)!).push(e);
    }
    return map;
  }, [filteredSchedule, daysInMonth]);

  // ── ハンドラ ────────────────────────────────────────────────

  // カード・電子マネー台帳の登録／更新（設定「口座・カード管理」から移設）
  async function saveCard() {
    if (!cardForm) return;
    setCardError(null);
    // チャージ先に選べない種別へ戻すときは、取り残される指定の件数を示して確認する
    if (
      cardForm.id !== null &&
      !isChargeableType(cardForm.type) &&
      editingChargeSourceCount > 0 &&
      !window.confirm(
        `このカードをチャージ先に指定している明細が ${editingChargeSourceCount} 件あります。\n` +
          `${ACCOUNT_TYPE_LABEL[cardForm.type]} に変更すると、以後このカードはチャージ先に選べなくなります` +
          `（既存の指定はそのまま残ります）。変更してよいですか？`,
      )
    ) {
      return;
    }

    const body: Record<string, string> = {
      name: cardForm.name,
      institution: cardForm.institution,
      // 種別は登録後も変更できる（取り違えて登録したカードをチャージ先に選べるようにするため）
      type: cardForm.type,
    };
    // 空文字は「未設定に戻す」意味を持たせたいので、編集時のみそのまま送る
    if (cardForm.lastFour || cardForm.id !== null) body.lastFour = cardForm.lastFour;
    if (cardForm.accountCode || cardForm.id !== null) body.accountCode = cardForm.accountCode;
    if (cardForm.note || cardForm.id !== null) body.note = cardForm.note;

    const res = await fetch(
      cardForm.id === null ? "/api/linked-accounts" : `/api/linked-accounts/${cardForm.id}`,
      {
        method: cardForm.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setCardError(j?.error ?? "保存に失敗しました");
      return;
    }
    const created = cardForm.id === null ? await res.json().catch(() => null) : null;
    setCardForm(null);
    await qc.invalidateQueries({ queryKey: ["linked-accounts"] });
    // 新規登録したカードをそのまま表示対象にする
    if (created?.data?.id) {
      setAccountId(created.data.id);
    }
  }

  async function deleteCard(a: CardAccount) {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/linked-accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      alert(j?.error ?? `削除に失敗しました。(HTTP ${res.status})`);
      return;
    }
    if (accountId === a.id) setAccountId(null);
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  // ファイルを受け取った時点では取り込まず、取込先カードの確認モーダルを開く。
  // CSV は明細の中身から取込先を判別できないため（カード会社ごとに書式が異なる）、
  // 選択中のカードへ黙って登録すると取り違えに気付けない。
  function requestImport(file: File) {
    setImportResult(null);
    setImportError(null);
    if (accountId === null) {
      setImportError("カード・電子マネーを登録してください。");
      resetFileInput();
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      resetFileInput();
      return;
    }
    setPendingFile(file);
  }

  function cancelImport() {
    setPendingFile(null);
    resetFileInput();
  }

  // 同じファイルを選び直しても change が発火するようにクリアする
  function resetFileInput() {}

  async function importFile(file: File) {
    if (accountId === null) return;
    setPendingFile(null);
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await fetch(`/api/linked-accounts/${accountId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      if (res.ok) {
        setImportResult((await res.json()) as ImportResult);
        qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
      } else {
        setImportError(await importErrorMessage(res));
      }
    } catch {
      setImportError(importNetworkErrorMessage);
    } finally {
      setImporting(false);
      resetFileInput();
    }
  }

  // 編集中のカードをチャージ先に指定している明細の件数（種別をクレジットへ戻すときの警告用）
  const editingChargeSourceCount =
    cardForm?.id != null
      ? ((accounts ?? []).find((a) => a.id === cardForm.id)?.chargeSourceCount ?? 0)
      : 0;
  // ── スケジュールモードのカレンダーの月送り ─────────────────────
  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const TABS: [Tab, string][] = [
    ["summary", "サマリ"],
    ["csv", "CSV インポート"],
  ];

  return (
    <AppShell>
      {/* ヘッダ（台帳の登録は設定から移設し、借入金管理の「借入追加」と同じ要領でここに置く） */}
      <PageHeader
        title="カード・電子マネー管理"
        lead={CARD_HELP.page}
        actions={
          <button
            type="button"
            onClick={() => {
              setCardError(null);
              setCardForm(BLANK_CARD);
            }}
            className="btn-primary shrink-0"
          >
            カード・電子マネー追加
          </button>
        }
      />

      {accounts && accounts.length === 0 && (
        <Notice tone="warn" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <span>
              カード・電子マネーが登録されていません。利用明細を記録するには、先に登録してください。
            </span>
            <button
              type="button"
              onClick={() => {
                setCardError(null);
                setCardForm(BLANK_CARD);
              }}
              className="shrink-0 text-amber-900 font-medium underline underline-offset-2 hover:text-amber-700"
            >
              カード・電子マネーを登録する
            </button>
          </div>
        </Notice>
      )}

      {/* タブ */}
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMsg(null);
        }}
        className="mb-4"
      />

      {/* 対象のカード・電子マネー（タブ直下に置き、どのタブでも同じ位置で切り替えられる）。
          CSV の取込先と、カードの編集・削除の対象を選ぶ。明細は実績管理の「履歴」で見る。 */}
      {accounts && accounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            id="card-account"
            aria-label="表示対象のカード・電子マネー"
            className="input-field w-60 ml-auto"
            value={accountId ?? ""}
            onChange={(e) => {
              setAccountId(Number(e.target.value));
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                [{ACCOUNT_TYPE_LABEL[a.type] ?? "カード"}] {a.name}（{a.institution}
                {a.lastFour ? ` ****${a.lastFour}` : ""}）
              </option>
            ))}
          </select>
          {/* 選択中のカード・電子マネーの編集・削除（設定「口座・カード管理」から移設） */}
          {selectedAccount && (
            <>
              <button
                type="button"
                aria-label={`${selectedAccount.name} を編集`}
                title="編集"
                onClick={() => {
                  setCardError(null);
                  setCardForm({
                    id: selectedAccount.id,
                    name: selectedAccount.name,
                    type: selectedAccount.type,
                    institution: selectedAccount.institution,
                    lastFour: selectedAccount.lastFour ?? "",
                    accountCode: selectedAccount.account?.code ?? "",
                    note: selectedAccount.note ?? "",
                  });
                }}
                className="text-slate-300 hover:text-indigo-500"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${selectedAccount.name} を削除`}
                title="削除"
                onClick={() => deleteCard(selectedAccount)}
                className="text-slate-300 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {/* 明細の一覧・登録は実績管理の履歴・カレンダーで行う */}
              <Link
                href={`/entry?tab=history&source=card&account=${selectedAccount.id}` as never}
                className="text-xs text-indigo-600 underline"
              >
                明細を見る
              </Link>
            </>
          )}
        </div>
      )}

      {/* CSV 取込先の確認モーダル。取り違え防止のため取込のたびに表示する */}
      {pendingFile && selectedAccount && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-1">CSV 取込先の確認</h2>
            <p className="text-xs text-slate-500 mb-4">
              CSV の中身から取込先は判別できません。下記の
              {isEMoney ? "電子マネー" : "カード"}の利用明細として登録します。
            </p>
            <dl className="text-sm border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
              <div className="flex gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 text-slate-500">ファイル</dt>
                <dd className="text-slate-700 break-all">{pendingFile.name}</dd>
              </div>
              <div className="flex gap-3 px-3 py-2 bg-amber-50">
                <dt className="w-20 shrink-0 text-slate-500">取込先</dt>
                <dd className="font-semibold text-slate-800">
                  [{ACCOUNT_TYPE_LABEL[selectedAccount.type] ?? "カード"}] {selectedAccount.name}
                  <span className="block text-xs font-normal text-slate-500">
                    {selectedAccount.institution}
                    {selectedAccount.lastFour ? ` ****${selectedAccount.lastFour}` : ""}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="text-xs text-amber-700 mb-4">
              取込先が違う場合はキャンセルし、画面上部の 「{isEMoney ? "電子マネー" : "カード"}
              」で選び直してから取り込んでください。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelImport}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => importFile(pendingFile)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                この{isEMoney ? "電子マネー" : "カード"}に取り込む
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カード・電子マネーの登録／編集モーダル（設定「口座・カード管理」から移設）*/}
      {cardForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-1">
              {cardForm.id === null ? "カード・電子マネー追加" : "カード・電子マネーを編集"}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              電子マネー（Suica・PayPay 等）もここから登録すると、この画面で利用履歴を登録できます。
              銀行口座の登録は「銀行管理」の「銀行追加」から行います。
            </p>
            <div className="space-y-3">
              {/* 種別は登録後も変更できる（実際にはプリペイドなのにクレジットで登録した、
                  といった取り違えを直せないとチャージ先に選べないため）。明細の符号や集計には
                  影響せず、変わるのは表示ラベルとチャージ先に選べるかどうかだけ。 */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">種別</label>
                <div className="flex flex-wrap rounded-lg overflow-hidden border border-slate-200 text-sm">
                  {LINKED_ACCOUNT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCardForm({ ...cardForm, type: t })}
                      className={`px-3 py-2 font-medium transition-colors ${
                        cardForm.type === t
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {ACCOUNT_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                  デビット・プリペイド・電子マネーは、他のカードや銀行口座の明細から「チャージ先」
                  として選べるようになります。後払いのクレジットカードは残高を持たないため選べません。
                </p>
                {/* クレジットへ戻すと、既にこのカードをチャージ先にしている明細の指定が取り残される */}
                {cardForm.id !== null &&
                  !isChargeableType(cardForm.type) &&
                  (editingChargeSourceCount ?? 0) > 0 && (
                    <p className="mt-1.5 text-[11px] text-amber-700 leading-relaxed">
                      このカードをチャージ先に指定している明細が {editingChargeSourceCount}{" "}
                      件あります。
                      クレジットカードに変更すると、以後このカードはチャージ先に選べなくなります
                      （既存の指定はそのまま残るので、必要なら実績管理の履歴の「解除」で外してください）。
                    </p>
                  )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">名称 *</label>
                <input
                  placeholder={
                    cardForm.type === "E_MONEY"
                      ? "例: モバイルSuica"
                      : cardForm.type === "PREPAID_CARD"
                        ? "例: JAL Global Wallet"
                        : cardForm.type === "DEBIT_CARD"
                          ? "例: 住信SBIデビット"
                          : "例: 楽天カード"
                  }
                  value={cardForm.name}
                  onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  {cardForm.type === "E_MONEY" ? "発行会社・サービス *" : "カード会社 *"}
                </label>
                <input
                  placeholder={
                    cardForm.type === "E_MONEY" ? "例: JR東日本" : "例: 楽天カード株式会社"
                  }
                  value={cardForm.institution}
                  onChange={(e) => setCardForm({ ...cardForm, institution: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">下4桁</label>
                <input
                  placeholder="1234"
                  maxLength={4}
                  value={cardForm.lastFour}
                  onChange={(e) => setCardForm({ ...cardForm, lastFour: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  紐付き勘定科目
                </label>
                <select
                  value={cardForm.accountCode}
                  onChange={(e) => setCardForm({ ...cardForm, accountCode: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {ledgerAccounts.map((a) => (
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
                  value={cardForm.note}
                  onChange={(e) => setCardForm({ ...cardForm, note: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {cardError && <p className="text-xs text-red-600">{cardError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setCardForm(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveCard}
                disabled={!cardForm.name || !cardForm.institution}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"
              >
                {cardForm.id === null ? "登録" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <Notice tone="info" onClose={() => setMsg(null)} className="mb-4">
          {msg}
        </Notice>
      )}

      {/* ── サマリタブ ───────────────────────────────────────
          銀行管理のキャッシュフロータブにある「口座間 資金フロー図」のカード版。
          引き落とし・チャージ（銀行から / カードから）・固定決済の線を 1 枚の図にまとめる。 */}
      {tab === "summary" && (
        <>
          <div className="card mb-6">
            <h2 className="section-title mb-1">カード・電子マネー 資金フロー図</h2>
            <SectionLead>{cardFlowHelp(cardFlow?.chargeMonths ?? 3)}</SectionLead>
            {!cardFlow ? (
              <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                読み込み中…
              </div>
            ) : cardFlow.cyclic ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                チャージ先の指定が循環しているためフロー図を描画できません。実績管理の「履歴」の
                チャージ先列で経路を見直してください。
              </p>
            ) : cardFlow.graph.links.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                描画できる資金の流れがありません。実績管理の「履歴」（カード・電子マネー／銀行）の
                チャージ先列・固定決済列、または銀行管理の「キャッシュフロー」タブ（引き落とし）
                から登録してください。
              </p>
            ) : (
              <AccountFlowDiagram data={cardFlow.graph} />
            )}
            {cardFlow && cardFlow.unlinked.length > 0 && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                引き落とし・チャージ・固定決済のいずれも未登録のため図に出ていません:{" "}
                {cardFlow.unlinked.map((a) => a.name).join(" / ")}
              </p>
            )}
          </div>

          {/* ── 引き落とし・固定決済スケジュール ──────────────────────
            銀行管理のキャッシュフロータブの「資金移動スケジュール」と同じ構成（一覧モード／スケジュールモード）。
            登録・削除は 引き落とし＝銀行管理の「キャッシュフロー」、固定決済＝実績管理の履歴 で行うため、
            ここは表示専用にしている（同じ操作を 2 か所に置くと登録先が分かりにくくなるため）。 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="section-title">引き落とし・固定決済スケジュール</h2>
            <SegmentedControl
              options={CARD_SCHEDULE_MODES}
              value={scheduleMode}
              onChange={setScheduleMode}
            />
            <select
              value={scheduleAccount === "all" ? "all" : String(scheduleAccount)}
              onChange={(e) =>
                setScheduleAccount(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              className="input-field text-sm w-auto ml-auto"
            >
              <option value="all">すべてのカード・電子マネー</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  [{ACCOUNT_TYPE_LABEL[a.type] ?? "カード"}] {a.name}
                </option>
              ))}
            </select>
          </div>

          <SectionLead className="mb-2">{CARD_HELP.schedule}</SectionLead>
          <InfoNote>{CARD_HELP.recurring}</InfoNote>

          {scheduleMode === "list" &&
            (filteredSchedule.length > 0 ? (
              <div className="card mb-6 overflow-x-auto">
                <table className="w-full text-sm min-w-[36rem]">
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
                        種別
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSchedule.map((e) => (
                      <tr key={e.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-500 tabular-nums">{e.day}日</td>
                        <td className="px-3 py-2 text-slate-700">{e.from}</td>
                        <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">→</td>
                        <td className="px-3 py-2 text-slate-700">
                          {e.kind === "recurring" ? (
                            <span className="text-rose-600 font-medium">{e.to}</span>
                          ) : (
                            e.to
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                          {yen(e.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs hidden md:table-cell">
                          {e.kindLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mb-6">
                引き落とし・固定決済がまだ登録されていません。引き落としは銀行管理の「キャッシュフロー」タブ、
                固定決済は実績管理の「履歴」の固定決済列から登録すると、この一覧と上のフロー図に表示されます。
              </p>
            ))}

          {/* スケジュールモード＝毎月の予定日を月次カレンダーで俯瞰する。
            予定日は「毎月◯日」なので、その月に無い日（31 日など）は月末に寄せて描く。 */}
          {scheduleMode === "calendar" && (
            <div className="card mb-6 p-0 overflow-hidden">
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
              <div className="grid grid-cols-7">
                {Array.from({ length: totalCells }, (_, i) => {
                  const day = i - firstWeekday + 1;
                  const isValid = day >= 1 && day <= daysInMonth;
                  const isToday =
                    isValid &&
                    viewYear === now.getFullYear() &&
                    viewMonth === now.getMonth() + 1 &&
                    day === now.getDate();
                  const dayEntries = isValid ? (scheduleByDay.get(day) ?? []) : [];
                  const weekday = i % 7;
                  return (
                    <div
                      key={i}
                      className={`min-h-[4.5rem] p-1.5 border-b border-r border-slate-100 text-left ${
                        isValid ? "" : "bg-slate-50/50"
                      }`}
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
                          {dayEntries.map((e) => (
                            <p
                              key={e.key}
                              title={`${e.from} → ${e.to}（${e.kindLabel}）`}
                              className={`text-[10px] truncate leading-tight ${
                                e.kind === "recurring" ? "text-rose-600" : "text-indigo-600"
                              }`}
                            >
                              {e.to} {yen(e.amount)}
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── CSV インポートタブ ───────────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6">
          <SectionLead className="-mb-3">{CARD_HELP.csv}</SectionLead>
          <CsvDropzone busy={importing} onFile={requestImport} />

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
                      件は既に取り込み済みのためスキップしました
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
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`date,description,amount
2026-06-25,AMAZON.CO.JP,-3980
2026-06-28,STARBUCKS COFFEE JAPAN,70
2026-06-30,楽天市場,-12000`}</pre>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li>
                <span className="font-medium">date</span>：利用日（YYYY-MM-DD）
              </li>
              <li>
                <span className="font-medium">description</span>：摘要（利用先）
              </li>
              <li>
                <span className="font-medium">amount</span>
                ：金額（カード会社・ウォレットの明細そのままの形式＝支出は負、入金は正。
                取込時に自動で符号反転され、一覧では利用＝正、返金＝負として表示されます）
              </li>
            </ul>
          </div>
        </div>
      )}
    </AppShell>
  );
}
