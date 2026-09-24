"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useMemo } from "react";
import { HelpCircle, Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { CATEGORY_HELP_TEXT } from "@/components/BankTransactionsPanel";
import { ChargeLinkModal } from "@/components/ChargeLinkModal";
import { AccountFlowDiagram, type FlowGraph } from "@/components/AccountFlowDiagram";
import {
  LINKED_ACCOUNT_TYPES,
  LINKED_ACCOUNT_TYPE_LABELS,
  isChargeableType,
  type LinkedAccountType,
} from "@/lib/linked-account-type";
import { TXN_SOURCE_LABEL as SOURCE_LABELS } from "@/lib/labels";

// 「転記する」を押した瞬間に発火する自動反映の説明（一括適用・学習ルールの両方）
const POST_HELP_TEXT =
  "「転記する」を押すと、同じ摘要で科目未設定の他の明細にも自動で科目が設定されます。" +
  "また摘要のキーワードを学習し、次回以降のCSV取込・自動同期でも自動的に科目が分類されます" +
  "（分類されるのは科目のみで、転記は明細ごとに別途手動で行う必要があります）。";

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
type Txn = {
  id: number;
  date: string;
  description: string;
  amount: number;
  source: "MANUAL" | "CSV" | "SYNC";
  categoryAccountId: number | null;
  categoryAccount: { id: number; code: string; name: string } | null;
  postedRecordId: number | null;
  /** 他カード・電子マネーへのチャージ（資金移動）の場合のチャージ先。値があれば科目紐付け・転記の対象外 */
  transferToAccountId: number | null;
  transferToAccount: { id: number; name: string } | null;
  /**
   * チャージ元の明細と、チャージ先に入った明細を対にする識別子。
   * transferToAccountId が無いのにこれだけ持つ行は「チャージ先に入った入金側」で、
   * こちらも収入として計上しない（チャージ元と合わせて二重に効くため）。
   */
  chargeGroupId: string | null;
};
// チャージの自動判定ルール（card_transfer_rules）
type CardTransferRule = {
  id: number;
  accountId: number;
  keyword: string;
  transferToAccountId: number;
  transferToAccount: { id: number; name: string };
};
type ImportResult = {
  inserted: number;
  /** 既に取り込み済みで重複していた行数 */
  skipped?: number;
  errors: { row: number; message: string }[];
};

// ── 定数 ────────────────────────────────────────────────────────
const now = new Date();
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// 明細一覧のページング（実績管理の履歴・銀行管理の明細一覧と同じ 30 件単位）
const TXN_PAGE_SIZE = 30;

const BLANK_MANUAL = {
  date: now.toISOString().slice(0, 10),
  description: "",
  amount: "",
  type: "charge" as "charge" | "refund",
};
const BLANK_CAL_FORM = { description: "", amount: "", type: "charge" as "charge" | "refund" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 電子マネー・プリペイドはカード番号が無く、明細も「チャージ残高からの支払い」なので文言を切り替える
const ACCOUNT_TYPE_LABEL = LINKED_ACCOUNT_TYPE_LABELS;

// カードの固定決済（毎月このカードで決済されるサブスク等）。銀行口座は持たない
type CardRecurring = {
  id: number;
  accountId: number;
  label: string;
  amount: number;
  day: number;
  categoryAccountId: number | null;
};

// チャージ（デビット・プリペイド・電子マネーへの資金移動）の説明。銀行明細の「振替」に相当する
const TRANSFER_HELP_TEXT =
  "デビットカード・プリペイドカード・電子マネーへのチャージは支出ではなく資金の移動なので、" +
  "収入・支出には計上しません（実際の支出はチャージ先の利用明細で計上します）。" +
  "誤って指定した場合は「解除」で戻せます。";

const CHARGE_HELP_TEXT =
  "この明細がデビットカード・プリペイドカード・電子マネーへのチャージなら、チャージ先を選んで" +
  "「指定」を押します。チャージ先の履歴が表示されるので、対になる入金明細があれば選んで紐付けます" +
  "（チャージ先に入金の記録が無ければ「紐づけずに指定」で構いません）。" +
  "指定した明細は収入・支出に計上されなくなり、付いている科目は外れます" +
  "（実際の支出はチャージ先の利用明細で計上します）。";

// チャージ先に入った入金明細（チャージ元と対にした側）のバッジの説明
const CHARGED_IN_HELP_TEXT =
  "他の口座・カードからのチャージとして紐付けられた入金明細です。チャージ元と対になっており、" +
  "収入として計上すると同じ資金が二重に効くため、科目の紐付けと実績への転記はできません。" +
  "「解除」を押すと紐付けが外れ、チャージ元は「履歴と未紐付け」に戻ります。";

const RECURRING_HELP_TEXT =
  "「登録する」を押すと、この明細を毎月このカードで固定決済される支払い（サブスク等）として登録します" +
  "（毎月の日付・金額・摘要は明細の内容を引き継ぎます）。カード払いは利用時点で現金が動かず、" +
  "実際の出金はカード全体の引き落とし 1 本にまとまるため、銀行の資金繰りには足し込みません。" +
  "引き落とし自体の登録は銀行管理の「資金移動」で行います。";

// 明細一覧のヘッダに出す説明（ここに無い列はヘルプアイコンを出さない）
const HEADER_HELP_TEXT: Record<string, string> = {
  科目: CATEGORY_HELP_TEXT,
  実績: POST_HELP_TEXT,
  チャージ先: CHARGE_HELP_TEXT,
  固定決済: RECURRING_HELP_TEXT,
};

type Tab = "summary" | "list" | "calendar" | "csv";

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

// スケジュールの表示モード（銀行管理の振替タブと同じ切替）
const CARD_SCHEDULE_MODES: [ScheduleMode, string][] = [
  ["list", "一覧モード"],
  ["calendar", "スケジュールモード"],
];
type ScheduleMode = "list" | "calendar";

type PostFilter = "all" | "posted" | "unposted";
const POST_FILTERS: [PostFilter, string][] = [
  ["all", "全件"],
  ["unposted", "実績未転記"],
  ["posted", "実績転記済"],
];

// 絞り込みの説明。チャージを未転記から外している理由を明示する
const POST_FILTER_HELP_TEXT =
  "「実績未転記」は、これから実績へ転記する明細だけを絞り込みます。" +
  "チャージ（デビットカード・プリペイドカード・電子マネーへの資金移動）は" +
  "それ自体が支出ではなく転記の対象外で、実際の支出はチャージ先の利用明細で計上するため、" +
  "この絞り込みには含めません（「全件」では表示されます）。";

// ── ページ ──────────────────────────────────────────────────────
// bank-transactions/page.tsx（銀行）と同構造。銀行管理のサマリタブに倣い、既定表示の
// 「サマリ」タブでカード・電子マネー関連の資金フロー図を示す。
// クレジット・デビット・プリペイド・電子マネー（Suica・PayPay 等）は明細の構造が同じなので
// 同じ画面で扱う。銀行口座を起点にする引き落としルールの登録は銀行管理側の役割で、
// この画面ではチャージ先の指定と、そのカードでの固定決済の登録だけを行う。
export default function CardTransactionsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState(BLANK_MANUAL);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // 取込先の取り違え防止。選択中のカードを確認してから取り込む（毎回表示する）
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  // 明細一覧のページ番号（0 始まり）
  const [txnPage, setTxnPage] = useState(0);
  // カード・電子マネー台帳の登録／編集モーダル（設定「口座・カード管理」から移設）
  const [cardForm, setCardForm] = useState<CardForm | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  // サマリタブのスケジュール（引き落とし・固定決済）の表示モードと対象カード
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("list");
  const [scheduleAccount, setScheduleAccount] = useState<number | "all">("all");

  // ── カレンダー ────────────────────────────────────────────────
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  const [calForm, setCalForm] = useState(BLANK_CAL_FORM);
  const [calSaving, setCalSaving] = useState(false);

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

  const { data: txns } = useQuery({
    queryKey: ["card-txns", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Txn[]> =>
      (await (await fetch(`/api/linked-accounts/${accountId}/transactions`)).json()).data ?? [],
  });

  const { data: categoryAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // このカードの固定決済（毎月の支払い項目）。明細一覧の「固定決済」列の登録済み判定に使う
  const { data: recurringPayments } = useQuery({
    queryKey: ["card-recurring", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<CardRecurring[]> =>
      (await (await fetch(`/api/card-recurring-payments?accountId=${accountId}`)).json()).data ??
      [],
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

  // チャージの自動判定ルール。表示中のカードに紐付いたものだけを見る
  // （同じ摘要が別のカードでは通常の利用を指すことがあるため）
  const { data: transferRules } = useQuery({
    queryKey: ["card-transfer-rules", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<CardTransferRule[]> =>
      (await (await fetch(`/api/card-transfer-rules?accountId=${accountId}`)).json()).data ?? [],
  });

  const categorizableAccounts = useMemo(
    () =>
      (categoryAccounts ?? []).filter((a) => ["REVENUE", "COGS", "EXPENSE"].includes(a.category)),
    [categoryAccounts],
  );
  // 台帳（カード・電子マネー）に紐付ける科目。設定の登録フォームと同じく資産・負債のみ
  const ledgerAccounts = useMemo(
    () => (categoryAccounts ?? []).filter((a) => ["ASSET", "LIABILITY"].includes(a.category)),
    [categoryAccounts],
  );

  const selectedAccount = (accounts ?? []).find((a) => a.id === accountId) ?? null;
  const isEMoney = selectedAccount?.type === "E_MONEY";

  const filteredTxns = useMemo(() => {
    const all = txns ?? [];
    if (postFilter === "posted") return all.filter((t) => t.postedRecordId !== null);
    // 実績未転記はこれから転記する明細を拾うための絞り込み。チャージはそもそも転記の対象外
    // （実際の支出はチャージ先の利用明細で計上する）なので、いつまでも残って紛らわしいため除く
    // チャージ先に入った入金明細（chargeGroupId だけを持つ行）も同じ理由で除く
    if (postFilter === "unposted")
      return all.filter(
        (t) =>
          t.postedRecordId === null && t.transferToAccountId === null && t.chargeGroupId === null,
      );
    return all;
  }, [txns, postFilter]);

  // 明細一覧は 30 件ずつ表示する（実績管理の履歴と同じ単位）。
  // 絞り込みやカード切替で件数が減った場合は末尾ページへ丸める
  const txnPageCount = Math.max(1, Math.ceil(filteredTxns.length / TXN_PAGE_SIZE));
  const currentTxnPage = Math.min(txnPage, txnPageCount - 1);
  const txnOffset = currentTxnPage * TXN_PAGE_SIZE;
  const pagedTxns = useMemo(
    () => filteredTxns.slice(txnOffset, txnOffset + TXN_PAGE_SIZE),
    [filteredTxns, txnOffset],
  );

  const byDay = useMemo(() => {
    const map = new Map<number, Txn[]>();
    for (const t of txns ?? []) {
      const d = new Date(t.date);
      if (d.getFullYear() !== viewYear || d.getMonth() + 1 !== viewMonth) continue;
      const day = d.getDate();
      (map.get(day) ?? map.set(day, []).get(day)!).push(t);
    }
    return map;
  }, [txns, viewYear, viewMonth]);
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  // ── サマリのスケジュール（銀行管理の振替タブと同じ並べ方）──────────────
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
      setTxnPage(0);
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
  function resetFileInput() {
    if (fileRef.current) fileRef.current.value = "";
  }

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

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) requestImport(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) requestImport(file);
  }

  async function deleteTxn(txnId: number) {
    await fetch(`/api/linked-accounts/${accountId}/transactions?txnId=${txnId}`, {
      method: "DELETE",
    });
    qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
  }

  // ── 明細から固定決済（毎月このカードで決済される支払い）を登録する ─────
  // 銀行口座は指定しない。カード払いは利用時点で現金が動かず、実際の出金はカード全体の
  // 引き落とし 1 本にまとまるため、口座を紐付けると資金繰りに同じ支出が二重で乗る。
  const normalizeLabel = (s: string) => s.trim().toLowerCase();
  // 摘要が一致する固定決済があれば「登録済み」として扱う（銀行管理の明細一覧と同じ判定）
  const recurringByLabel = useMemo(() => {
    const m = new Map<string, CardRecurring>();
    for (const r of recurringPayments ?? []) {
      const label = normalizeLabel(r.label);
      if (label && !m.has(label)) m.set(label, r);
    }
    return m;
  }, [recurringPayments]);
  const matchedRecurring = (t: Txn) => recurringByLabel.get(normalizeLabel(t.description)) ?? null;
  const differsFromTxn = (r: CardRecurring, t: Txn) =>
    r.day !== new Date(t.date).getDate() ||
    Math.round(Number(r.amount)) !== Math.round(Math.abs(t.amount));

  async function registerRecurringFromTxn(t: Txn) {
    if (accountId === null) return;
    const day = new Date(t.date).getDate();
    const res = await fetch("/api/card-recurring-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        label: t.description,
        day,
        amount: Math.abs(t.amount),
        // 明細に付いている科目をそのまま引き継ぐ（未紐付けなら後から設定する）
        categoryAccountId: t.categoryAccountId,
      }),
    });
    if (res.ok) {
      setMsg(`毎月${day}日の固定決済として登録しました。サマリのフロー図にも表示されます。`);
      qc.invalidateQueries({ queryKey: ["card-recurring", accountId] });
      qc.invalidateQueries({ queryKey: ["card-flow"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`登録に失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  // 登録済みの固定決済を、この明細の日付・金額で書き換える
  async function rewriteRecurringFromTxn(r: CardRecurring, t: Txn) {
    const day = new Date(t.date).getDate();
    const amount = Math.round(Math.abs(t.amount));
    const ok = confirm(
      `「${r.label}」は毎月${r.day}日・${yen(Number(r.amount))}で登録済みです。\n` +
        `この明細の内容（毎月${day}日・${yen(amount)}）で書き換えますか？`,
    );
    if (!ok) return;
    const res = await fetch(`/api/card-recurring-payments/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, amount }),
    });
    if (res.ok) {
      setMsg(`毎月${day}日・${yen(amount)}に書き換えました。`);
      qc.invalidateQueries({ queryKey: ["card-recurring", accountId] });
      qc.invalidateQueries({ queryKey: ["card-flow"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`書き換えに失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  // 固定決済の登録を取り消す（明細そのものは残る）
  async function deleteRecurring(r: CardRecurring) {
    if (!confirm(`「${r.label}」の固定決済の登録を解除しますか？`)) return;
    const res = await fetch(`/api/card-recurring-payments/${r.id}`, { method: "DELETE" });
    if (res.ok) {
      setMsg("固定決済の登録を解除しました。");
      qc.invalidateQueries({ queryKey: ["card-recurring", accountId] });
      qc.invalidateQueries({ queryKey: ["card-flow"] });
    } else setMsg("解除に失敗しました。");
  }

  async function setTxnCategory(txnId: number, categoryAccountId: number | null) {
    await fetch(`/api/card-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId }),
    });
    qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
  }

  // ── 明細をチャージ（資金移動）に指定する ─────────────────────────
  // 明細 1 件ずつの指定。数百件まとめて指定したいときは摘要キーワードの一括指定を使う。
  // チャージ先に選べるのは残高を持つ決済手段（デビット・プリペイド・電子マネー）だけで、
  // クレジットカードは後払いなので入金先にならない。
  const chargeTargets = useMemo(
    () => (accounts ?? []).filter((a) => a.id !== accountId && isChargeableType(a.type)),
    [accounts, accountId],
  );
  // 編集中のカードをチャージ先に指定している明細の件数（種別をクレジットへ戻すときの警告用）
  const editingChargeSourceCount =
    cardForm?.id != null
      ? ((accounts ?? []).find((a) => a.id === cardForm.id)?.chargeSourceCount ?? 0)
      : 0;
  // 明細 id -> 選択中のチャージ先（「指定」を押すまでは送らない）
  const [txnChargeTarget, setTxnChargeTarget] = useState<Record<number, string>>({});
  // 「指定」を押したときに開く紐付けモーダル（チャージ先の履歴から対になる明細を選ぶ）
  const [chargeLink, setChargeLink] = useState<{ txn: Txn; target: CardAccount } | null>(null);

  // チャージ（デビット・プリペイド・電子マネーへの資金移動）の指定・解除。
  // 指定した明細は収入・支出に計上されなくなる（実際の支出はチャージ先の利用明細で計上する）。
  // pairTxnId を渡すと、チャージ先に入った明細と対にして、そちらも収支の対象外にする。
  async function setTxnTransfer(
    txnId: number,
    transferToAccountId: number | null,
    pairTxnId: number | null = null,
  ) {
    const res = await fetch(`/api/card-transactions/${txnId}/transfer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferToAccountId, pairTxnId }),
    });
    if (res.ok) {
      setMsg(
        transferToAccountId === null
          ? "チャージの指定を解除しました。科目の紐付け・転記ができるようになります。"
          : pairTxnId !== null
            ? "チャージ先の明細と紐付けました。両方とも収入・支出には計上されません。"
            : "チャージ（資金移動）に指定しました。収入・支出には計上されません。",
      );
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`変更に失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
    // 紐付けた入金明細はチャージ先のカードのものなので、全カードの明細を取り直す
    qc.invalidateQueries({ queryKey: ["card-txns"] });
    qc.invalidateQueries({ queryKey: ["charge-candidates"] });
    // チャージはサマリのフロー図（カード → チャージ先）の元データでもある
    qc.invalidateQueries({ queryKey: ["card-flow"] });
  }

  // 自動判定ルールの削除。既にチャージ指定済みの明細はそのまま残る
  async function deleteTransferRule(ruleId: number) {
    if (!window.confirm("このルールを削除します。以後の CSV 取込では自動判定されなくなります。"))
      return;
    const res = await fetch(`/api/card-transfer-rules?id=${ruleId}`, { method: "DELETE" });
    if (res.ok) {
      setMsg("ルールを削除しました。指定済みの明細はそのまま残ります。");
      qc.invalidateQueries({ queryKey: ["card-transfer-rules", accountId] });
    } else setMsg("ルールの削除に失敗しました。");
  }

  async function postTxnToActuals(txnId: number) {
    const res = await fetch(`/api/card-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: true, learn: true }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const n = json.updatedSiblingCount ?? 0;
      setMsg(
        n > 0
          ? `実績へ転記しました。同じ摘要の未分類明細 ${n} 件にも科目を設定しました。`
          : "実績へ転記しました。",
      );
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`転記に失敗しました: ${err.error ?? "エラー"}`);
    }
    qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
  }

  async function submitManual(e: { preventDefault(): void }) {
    e.preventDefault();
    if (accountId === null) {
      setMsg("カード・電子マネーを登録してください。");
      return;
    }
    const rawAmt = Number(manual.amount);
    // card_transactions は +利用（支出） / -返金
    const amount = manual.type === "charge" ? Math.abs(rawAmt) : -Math.abs(rawAmt);
    const res = await fetch(`/api/linked-accounts/${accountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: manual.date,
        description: manual.description,
        amount,
      }),
    });
    if (res.ok) {
      setManual(BLANK_MANUAL);
      setMsg("登録しました");
      qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
    } else setMsg("登録に失敗しました");
  }

  // ── カレンダーハンドラ ───────────────────────────────────────
  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
    setSelectedDay(null);
  }

  async function submitCalManual(e: { preventDefault(): void }) {
    e.preventDefault();
    if (accountId === null || !selectedDay) return;
    setCalSaving(true);
    const rawAmt = Number(calForm.amount);
    const amount = calForm.type === "charge" ? Math.abs(rawAmt) : -Math.abs(rawAmt);
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    const res = await fetch(`/api/linked-accounts/${accountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateStr, description: calForm.description, amount }),
    });
    if (res.ok) {
      setCalForm(BLANK_CAL_FORM);
      qc.invalidateQueries({ queryKey: ["card-txns", accountId] });
    } else {
      setMsg("登録に失敗しました");
    }
    setCalSaving(false);
  }

  const TABS: [Tab, string][] = [
    ["summary", "サマリ"],
    ["list", "明細一覧"],
    ["calendar", "カレンダー"],
    ["csv", "CSV インポート"],
  ];

  return (
    <AppShell>
      {/* ヘッダ（台帳の登録は設定から移設し、借入金管理の「借入追加」と同じ要領でここに置く） */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="page-title">カード・電子マネー管理</h1>
        <button
          type="button"
          onClick={() => {
            setCardError(null);
            setCardForm(BLANK_CARD);
          }}
          className="btn-primary px-4 py-2 text-sm shrink-0"
        >
          カード・電子マネー追加
        </button>
      </div>

      {accounts && accounts.length === 0 && (
        <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 flex items-center justify-between gap-3">
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
      )}

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
          </button>
        ))}
      </div>

      {/* 表示対象のカード・電子マネー（タブ直下に置き、どのタブでも同じ位置で切り替えられる）。
          銀行管理の明細一覧と同じく、ラベルを置かず右端に寄せた input-field のセレクタで統一する。
          サマリのフロー図は全カードを 1 枚に描くので、そこでは表示対象を出さない（銀行管理と同じ）。 */}
      {tab !== "summary" && accounts && accounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            id="card-account"
            aria-label="表示対象のカード・電子マネー"
            className="input-field w-60 ml-auto"
            value={accountId ?? ""}
            onChange={(e) => {
              setAccountId(Number(e.target.value));
              setTxnPage(0);
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
                      （既存の指定はそのまま残るので、必要なら明細一覧の「解除」で外してください）。
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
        <div className="mb-4 text-sm text-slate-700 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2 flex items-center justify-between">
          {msg}
          <button onClick={() => setMsg(null)} className="text-slate-400 hover:text-slate-600 ml-4">
            ✕
          </button>
        </div>
      )}

      {/* ── サマリタブ ───────────────────────────────────────
          銀行管理のサマリにある「口座間 資金フロー図」のカード版。
          引き落とし・チャージ（銀行から / カードから）・固定決済の線を 1 枚の図にまとめる。 */}
      {tab === "summary" && (
        <>
          <div className="card mb-6">
            <h2 className="section-title mb-1">カード・電子マネー 資金フロー図</h2>
            <p className="text-xs text-slate-400 mb-3">
              銀行口座からの引き落とし（銀行管理の「振替」で登録）、銀行口座やカードから
              デビット・プリペイド・電子マネーへのチャージ、カードでの固定決済を 1 枚にまとめて
              表示します。同じ組み合わせが複数ある場合は金額を合算して 1 本の線で描きます。
              チャージだけは明細の実績が元なので、直近 {cardFlow?.chargeMonths ?? 3} か月を
              月あたりに均した額で描いています（銀行からのチャージは銀行管理の明細一覧、
              カードからのチャージはこの画面の明細一覧の「チャージ先」列で指定したものが元です）。
            </p>
            {!cardFlow ? (
              <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                読み込み中…
              </div>
            ) : cardFlow.cyclic ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                チャージ先の指定が循環しているためフロー図を描画できません。「明細一覧」タブの
                チャージ先列で経路を見直してください。
              </p>
            ) : cardFlow.graph.links.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                描画できる資金の流れがありません。「明細一覧」タブのチャージ先列・固定決済列、
                銀行管理の明細一覧の「チャージ先」列、または銀行管理の「振替」タブ（引き落とし）
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
            銀行管理の振替タブの「資金移動スケジュール」と同じ構成（一覧モード／スケジュールモード）。
            登録・削除は 引き落とし＝銀行管理の「振替」、固定決済＝この画面の明細一覧 で行うため、
            ここは表示専用にしている（同じ操作を 2 か所に置くと登録先が分かりにくくなるため）。 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="section-title">引き落とし・固定決済スケジュール</h2>
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
              {CARD_SCHEDULE_MODES.map(([m, label]) => (
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

          <p className="text-xs text-slate-400 mb-2">
            毎月の引き落とし（銀行口座 →
            カード）と固定決済（このカードで毎月支払う項目）の予定日です。
            ここは表示のみで、引き落としの登録は銀行管理の「振替」タブ、固定決済の登録は「明細一覧」タブの
            固定決済列から行います。
          </p>

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
                引き落とし・固定決済がまだ登録されていません。引き落としは銀行管理の「振替」タブ、
                固定決済は「明細一覧」タブの固定決済列から登録すると、この一覧と上のフロー図に表示されます。
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

      {/* ── 明細一覧タブ ─────────────────────────────────────── */}
      {tab === "list" && (
        <>
          {/* 手動登録フォーム */}
          <div className="card mb-4">
            <h2 className="section-title mb-1">利用明細を手動登録</h2>
            {/* チャージは明細を新たに作るのではなく、取り込んだ（または手入力した）明細に
                チャージ先を指定して記録する。両側の明細をまとめて作る導線は持たない。 */}
            <p className="text-xs text-slate-500 mb-3">
              {isEMoney
                ? "電子マネーの利用履歴（支払い・返金）を登録します。チャージ（入金）は支出ではないため、チャージ元の明細の「チャージ先」列で指定してください（銀行から入れた場合は銀行管理の明細一覧のチャージ先列です）。"
                : "カードの利用履歴（利用・返金）を登録します。他のカード・電子マネーへのチャージは、その明細の「チャージ先」列で指定してください。"}
            </p>
            <form onSubmit={submitManual} className="flex flex-wrap gap-3 items-end">
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-sm h-9 self-end">
                {(["charge", "refund"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setManual((m) => ({ ...m, type: d }))}
                    className={`px-3 font-medium transition-colors ${manual.type === d ? (d === "charge" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  >
                    {d === "charge" ? "利用" : "返金"}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">利用日</label>
                <input
                  type="date"
                  required
                  value={manual.date}
                  onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-40">
                <label className="text-xs text-slate-500">摘要（利用先）</label>
                <input
                  type="text"
                  required
                  placeholder={isEMoney ? "例: セブン-イレブン（Suica）" : "例: AMAZON.CO.JP"}
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
              <button type="submit" className="btn-primary px-5 py-2 text-sm self-end">
                登録する
              </button>
            </form>
          </div>

          {/* 取込時に自動でチャージ扱いにするルール（card_transfer_rules）。
              一括指定フォームは廃止し、指定は明細一覧の「チャージ先」列で 1 件ずつ行う。
              過去に保存したルールは以後の CSV 取込にも効き続けるため、確認と削除だけ残す。 */}
          {(transferRules ?? []).length > 0 && (
            <div className="card p-4 mb-4">
              <div className="flex items-center gap-1.5 mb-1">
                <h3 className="text-sm font-semibold text-slate-700">
                  取込時に自動でチャージ扱いにするルール
                </h3>
                <span className="relative inline-flex items-center group/help">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                  <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-72 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/help:block">
                    {TRANSFER_HELP_TEXT}
                  </span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                摘要が一致する明細を CSV 取込時に自動でチャージ扱いにします。削除しても、指定済みの
                明細はそのまま残ります。個別の指定は明細一覧の「チャージ先」列から行います。
              </p>
              <ul className="flex flex-wrap gap-2">
                {(transferRules ?? []).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1"
                  >
                    <span className="text-slate-600">
                      {r.keyword} → {r.transferToAccount.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteTransferRule(r.id)}
                      className="text-slate-300 hover:text-red-500"
                      aria-label="ルールを削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 表示切替 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-8">
              {POST_FILTERS.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setPostFilter(f);
                    setTxnPage(0);
                  }}
                  className={`px-3 font-medium transition-colors ${postFilter === f ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* チャージを「実績未転記」から外している理由を示す */}
            <span className="relative inline-flex items-center group/filter">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-72 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/filter:block">
                {POST_FILTER_HELP_TEXT}
              </span>
            </span>
            <span className="text-xs text-slate-400">
              {filteredTxns.length} 件
              {filteredTxns.length > 0 && (
                <>
                  （{txnOffset + 1}〜{Math.min(txnOffset + TXN_PAGE_SIZE, filteredTxns.length)}{" "}
                  件を表示）
                </>
              )}
              {postFilter === "unposted" && "・チャージを除く"}
            </span>
          </div>

          {/* 明細テーブル（列が多いので横スクロールさせる） */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[56rem]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {[
                      "日付",
                      "摘要",
                      "金額",
                      "科目",
                      "取得元",
                      "実績",
                      "チャージ先",
                      "固定決済",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-slate-600"
                      >
                        {HEADER_HELP_TEXT[h] ? (
                          <span className="relative inline-flex items-center gap-1 group">
                            {h}
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                            <span className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover:block">
                              {HEADER_HELP_TEXT[h]}
                            </span>
                          </span>
                        ) : (
                          h
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedTxns.map((t) => {
                    // 摘要が一致する固定決済があれば「登録済み」表示に切り替える
                    const registered = matchedRecurring(t);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 group">
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                          {new Date(t.date).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-4 py-2.5">{t.description}</td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums ${t.amount > 0 ? "text-red-600" : "text-emerald-600"}`}
                        >
                          {yen(t.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* チャージは資金の移動なので科目に紐付けない（二重計上の防止） */}
                          {t.transferToAccountId ? (
                            <span className="relative inline-flex items-center gap-1 group/transfer">
                              <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                チャージ
                              </span>
                              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/transfer:block">
                                {t.transferToAccount
                                  ? `${t.transferToAccount.name} へのチャージ。${TRANSFER_HELP_TEXT}`
                                  : TRANSFER_HELP_TEXT}
                              </span>
                            </span>
                          ) : t.chargeGroupId ? (
                            // チャージ元の明細と対にした入金側。こちらも収支には計上しない
                            <span className="relative inline-flex items-center gap-1 group/charged">
                              <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                チャージ入金
                              </span>
                              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/charged:block">
                                {CHARGED_IN_HELP_TEXT}
                              </span>
                              <button
                                onClick={() => setTxnTransfer(t.id, null)}
                                className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap"
                              >
                                解除
                              </button>
                            </span>
                          ) : (
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
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">
                          {SOURCE_LABELS[t.source] ?? t.source}
                        </td>
                        <td className="px-4 py-2.5">
                          {t.transferToAccountId || t.chargeGroupId ? (
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : t.postedRecordId !== null ? (
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
                        {/* チャージ先の指定・解除。デビット・プリペイド・電子マネーだけを選べる */}
                        <td className="px-4 py-2.5">
                          {t.transferToAccountId ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600 whitespace-nowrap">
                                {t.transferToAccount?.name ?? "指定済み"}
                              </span>
                              {/* チャージ先の入金明細と対になっているかを示す */}
                              <span
                                className={`text-[10px] whitespace-nowrap ${t.chargeGroupId ? "text-emerald-600" : "text-slate-400"}`}
                                title={
                                  t.chargeGroupId
                                    ? "チャージ先の明細と紐付け済みです"
                                    : "チャージ先の入金明細とは紐付いていません（チャージ先に入金の記録が無い場合はこのままで構いません）"
                                }
                              >
                                {t.chargeGroupId ? "履歴と紐付け済み" : "履歴と未紐付け"}
                              </span>
                              <button
                                onClick={() => setTxnTransfer(t.id, null)}
                                className="text-xs text-slate-400 hover:text-red-600 text-left whitespace-nowrap"
                              >
                                解除
                              </button>
                            </div>
                          ) : t.chargeGroupId ? (
                            // 入金側は自分ではチャージ先を持たない（相手のチャージ元が持つ）
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : t.postedRecordId !== null ? (
                            // 転記済みは実績が立っているため、先に転記の取り消しが要る
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : chargeTargets.length === 0 ? (
                            <span className="text-xs text-slate-300 whitespace-nowrap">
                              チャージ先未登録
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <select
                                value={txnChargeTarget[t.id] ?? ""}
                                onChange={(e) =>
                                  setTxnChargeTarget((m) => ({ ...m, [t.id]: e.target.value }))
                                }
                                className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-32"
                              >
                                <option value="">チャージ先を選ぶ</option>
                                {chargeTargets.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}（{ACCOUNT_TYPE_LABEL[a.type]}）
                                  </option>
                                ))}
                              </select>
                              {/* チャージ先の履歴から対になる明細を選べるようモーダルを挟む */}
                              <button
                                onClick={() => {
                                  const target = chargeTargets.find(
                                    (a) => a.id === Number(txnChargeTarget[t.id]),
                                  );
                                  if (target) setChargeLink({ txn: t, target });
                                }}
                                disabled={!txnChargeTarget[t.id]}
                                className="text-xs text-indigo-600 hover:text-indigo-700 text-left disabled:text-slate-300 disabled:cursor-not-allowed"
                              >
                                指定
                              </button>
                            </div>
                          )}
                        </td>
                        {/* 固定決済（毎月このカードで決済される支払い）の登録 */}
                        <td className="px-4 py-2.5">
                          {t.transferToAccountId || t.chargeGroupId ? (
                            // チャージは資金の移動なので毎月の支払い項目にはしない
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : registered ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded whitespace-nowrap w-fit">
                                登録済み
                              </span>
                              {differsFromTxn(registered, t) && (
                                <>
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    毎月{registered.day}日 · {yen(Number(registered.amount))}
                                  </span>
                                  <button
                                    onClick={() => rewriteRecurringFromTxn(registered, t)}
                                    className="text-xs text-amber-600 hover:text-amber-700 text-left whitespace-nowrap"
                                  >
                                    この明細で書き換える
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => deleteRecurring(registered)}
                                className="text-xs text-slate-400 hover:text-red-600 text-left whitespace-nowrap"
                              >
                                解除
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => registerRecurringFromTxn(t)}
                              className="text-xs text-indigo-600 hover:text-indigo-700 text-left"
                            >
                              登録する
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
                    );
                  })}
                  {filteredTxns.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                        {(txns ?? []).length === 0
                          ? "明細がありません"
                          : "この条件に一致する明細はありません"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredTxns.length > TXN_PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTxnPage(Math.max(0, currentTxnPage - 1))}
                  disabled={currentTxnPage === 0}
                  className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  ← 前の {TXN_PAGE_SIZE} 件
                </button>
                <span className="text-xs text-slate-400">
                  {currentTxnPage + 1} / {txnPageCount} ページ
                </span>
                <button
                  type="button"
                  onClick={() => setTxnPage(Math.min(txnPageCount - 1, currentTxnPage + 1))}
                  disabled={currentTxnPage >= txnPageCount - 1}
                  className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  次の {TXN_PAGE_SIZE} 件 →
                </button>
              </div>
            )}
          </div>
        </>
      )}

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
            {!txns ? (
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
                  const dayEntries = isValid ? (byDay.get(day) ?? []) : [];
                  const totalCharge = dayEntries
                    .filter((t) => t.amount > 0)
                    .reduce((s, t) => s + t.amount, 0);
                  const totalRefund = dayEntries
                    .filter((t) => t.amount < 0)
                    .reduce((s, t) => s + -t.amount, 0);
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
                          {totalCharge > 0 && (
                            <p className="text-[10px] text-red-600 truncate leading-tight">
                              {yen(totalCharge)}
                            </p>
                          )}
                          {totalRefund > 0 && (
                            <p className="text-[10px] text-emerald-600 truncate leading-tight">
                              −{yen(totalRefund)}
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
                  <p className="text-xs text-slate-400 mt-0.5">{selectedEntries.length} 件の明細</p>
                </div>

                {selectedEntries.length > 0 && (
                  <div className="card p-0 overflow-hidden">
                    <ul className="divide-y divide-slate-100">
                      {selectedEntries.map((t) => (
                        <li key={t.id} className="flex items-start gap-2 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-800 truncate">
                              {t.description}
                            </p>
                            {t.categoryAccount && (
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {t.categoryAccount.code} {t.categoryAccount.name}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-xs font-semibold ${t.amount > 0 ? "text-red-600" : "text-emerald-600"}`}
                            >
                              {yen(t.amount)}
                            </span>
                            <button
                              onClick={() => deleteTxn(t.id)}
                              className="text-slate-300 hover:text-red-400 text-xs"
                              title="削除"
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="card">
                  <h3 className="text-xs font-semibold text-slate-600 mb-3">支払いを追加</h3>
                  <form onSubmit={submitCalManual} className="flex flex-col gap-2.5">
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                      {(["charge", "refund"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setCalForm((f) => ({ ...f, type: d }))}
                          className={`flex-1 py-1.5 font-medium transition-colors ${
                            calForm.type === d
                              ? d === "charge"
                                ? "bg-rose-500 text-white"
                                : "bg-emerald-500 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          {d === "charge" ? "利用" : "返金"}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">摘要（利用先）</label>
                      <input
                        type="text"
                        required
                        placeholder={isEMoney ? "例: セブン-イレブン（Suica）" : "例: AMAZON.CO.JP"}
                        value={calForm.description}
                        onChange={(e) => setCalForm((f) => ({ ...f, description: e.target.value }))}
                        className="input-field text-xs"
                      />
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
                    <button
                      type="submit"
                      disabled={calSaving || accountId === null}
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
                  支払いを入力してください
                </p>
              </div>
            )}
          </div>
        </div>
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

      {/* チャージ指定時の紐付けモーダル（チャージ先の履歴から対になる明細を選ぶ） */}
      {chargeLink && (
        <ChargeLinkModal
          source={{
            date: chargeLink.txn.date,
            description: chargeLink.txn.description,
            amount: chargeLink.txn.amount,
          }}
          target={{ id: chargeLink.target.id, name: chargeLink.target.name }}
          onCancel={() => setChargeLink(null)}
          onConfirm={(pairTxnId) => {
            setTxnTransfer(chargeLink.txn.id, chargeLink.target.id, pairTxnId);
            setChargeLink(null);
          }}
        />
      )}
    </AppShell>
  );
}
