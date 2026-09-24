"use client";

// 入出金管理のパネル。ページ（/bank-transactions）から「銀行管理」のタブへ移設した。
// AppShell とページ見出しは呼び出し側（/bank-accounts）が持つ。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { ChargeLinkModal } from "@/components/ChargeLinkModal";
import { isChargeableType, LINKED_ACCOUNT_TYPE_LABELS } from "@/lib/linked-account-type";
import type { LinkedAccountType } from "@/lib/linked-account-type";
import {
  TRANSFER_CHANNEL_LABELS as CHANNEL_LABELS,
  TXN_SOURCE_LABEL as SOURCE_LABELS,
} from "@/lib/labels";

// 「転記する」を押した瞬間に発火する自動反映の説明（一括適用・学習ルールの両方）
const POST_HELP_TEXT =
  "「転記する」を押すと、同じ摘要で科目未設定の他の明細にも自動で科目が設定されます。" +
  "また摘要のキーワードを学習し、次回以降のCSV取込・自動同期でも自動的に科目が分類されます" +
  "（分類されるのは科目のみで、転記は明細ごとに別途手動で行う必要があります）。";

// ── 型 ──────────────────────────────────────────────────────────
type BankAccount = { id: number; name: string; bankName: string; role: string };
type CategoryAccount = { id: number; code: string; name: string; category: string };
type Txn = {
  id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  source: "MANUAL" | "CSV" | "SYNC";
  categoryAccountId: number | null;
  categoryAccount: { id: number; code: string; name: string } | null;
  postedRecordId: number | null;
  /** 口座間振替で対になる明細の識別子。値があれば科目紐付け・転記の対象外 */
  transferGroupId: string | null;
  /** デビット・プリペイド・電子マネーへのチャージの場合のチャージ先。値があれば科目紐付け・転記の対象外 */
  chargeToAccountId: number | null;
  chargeToAccount: { id: number; name: string } | null;
  /** チャージ先に入った明細と対にする識別子（紐付け済みかどうかの表示に使う） */
  chargeGroupId: string | null;
};
type Transfer = {
  id: number;
  label: string | null;
  day: number;
  amount: number;
  channel: string;
  kind: string;
  note: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  fromAccount: BankAccount | null;
  toAccount: BankAccount | null;
  linkedAccountId: number | null;
  linkedAccount: CardAccount | null;
};
// カード引き落としで紐付ける登録済みカード・電子マネー
type CardAccount = { id: number; name: string; type: string; institution: string };
// 取込済み明細どうしの振替候補（GET /api/bank-transfers/candidates）
type CandidateSide = {
  id: number;
  accountId: number;
  accountName: string;
  bankName: string;
  date: string;
  description: string;
  amount: number;
  categoryAccountId: number | null;
};
type TransferCandidate = {
  out: CandidateSide;
  in: CandidateSide;
  amount: number;
  dayGap: number;
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
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 相手先の登録済み口座を紐付けられる種別。銀行振込は from / to の両方が埋まると
// 「毎月の銀行→銀行の振替」になる（片側だけのルールでは相手口座の残高が動かない）。
const PARTNER_ACCOUNT_CHANNELS = ["AUTO_DEBIT", "BANK_TRANSFER"];

// 明細一覧のページング（実績管理の履歴と同じ 30 件単位）
const TXN_PAGE_SIZE = 30;

// 明細一覧の「科目」列の説明（二重計上を避けるための案内）
export const CATEGORY_HELP_TEXT =
  "科目は「そのお金が最終的に何に使われたか」で登録します。" +
  "カード・電子マネーへのチャージや引き落としなど、他の項目で既に計上している支払いには" +
  "科目を紐付けないでください（二重計上になります）。" +
  "他項目で計上されていない最終経路での支払い金額と項目で登録をお願いします。";

// 明細一覧の「チャージ先」列の説明
const CHARGE_HELP_TEXT =
  "この出金がデビットカード・プリペイドカード・電子マネー（Suica・PayPay 等）へのチャージなら、" +
  "チャージ先を選んで「指定」を押します。チャージ先の履歴が表示されるので、対になる入金明細が" +
  "あれば選んで紐付けます（チャージ先に入金の記録が無ければ「紐づけずに指定」で構いません）。" +
  "チャージは支出ではなく資金の移動なので、指定した明細は収入・支出に計上されなくなり、" +
  "付いている科目は外れます（実際の支出はチャージ先の利用明細で計上します）。口座残高には従来どおり反映されます。";

// 明細一覧の「固定入出金」列の説明
const RECURRING_HELP_TEXT =
  "種別を選んで「登録する」を押すと、この明細を毎月の支払い・入金項目として登録します" +
  "（毎月の日付・金額・摘要は明細の内容を引き継ぎます）。登録した項目は資金移動タブの" +
  "カレンダーと資金フローに反映されます。";

const BLANK_MANUAL = {
  date: now.toISOString().slice(0, 10),
  description: "",
  amount: "",
  type: "expense" as "income" | "expense",
};
// 口座間振替（都度）の登録フォーム。出金元・入金先の 2 口座に明細を 1 操作で作る
const BLANK_BANK_TRANSFER = {
  date: now.toISOString().slice(0, 10),
  fromAccountId: "" as string,
  toAccountId: "" as string,
  amount: "",
  description: "",
};

// 明細一覧のヘッダに出す説明（ここに無い列はヘルプアイコンを出さない）
const HEADER_HELP_TEXT: Record<string, string> = {
  科目: CATEGORY_HELP_TEXT,
  実績: POST_HELP_TEXT,
  チャージ先: CHARGE_HELP_TEXT,
  固定入出金: RECURRING_HELP_TEXT,
};

// 明細一覧の「振替」バッジの説明
const TRANSFER_HELP_TEXT =
  "口座間の振替として登録された明細です。自己資金の移動なので収入・支出には計上せず、" +
  "科目の紐付けと実績への転記はできません（残高にのみ反映されます）。削除すると相手口座の明細も一緒に削除されます。";

// 取込済み明細の振替紐付け（案 C）の説明
const TRANSFER_MATCH_HELP_TEXT =
  "両方の口座の CSV を取り込むと、1 回の資金移動が「出金側」と「入金側」の 2 明細に分かれて入ります。" +
  "そのままどちらも科目に紐付けると支出と収入で二重に計上されるため、対になる明細どうしを振替として紐付けます。" +
  "紐付けても明細は消えないので口座残高は変わりません。変わるのは収入・支出として集計されるかどうかだけです。";

// 振替候補の日付のずれの選択肢（他行宛の振込は着金が翌営業日以降になることがある）
const DAY_GAP_OPTIONS = [0, 1, 3, 7] as const;

const BLANK_RECURRING = {
  label: "",
  channel: "AUTO_DEBIT" as string,
  day: 25,
  amount: "",
  note: "",
  direction: "out" as "in" | "out",
  // 登録先の口座（この口座の入出金として登録する）。空 = カレンダーの対象口座に従う
  ownerAccountId: "" as string,
  // 銀行引き落とし: 相手側の登録済み銀行口座（空 = 外部）
  partnerAccountId: "" as string,
  // カード引き落とし: 登録済みカード・電子マネー（空 = 未紐付け）
  linkedAccountId: "" as string,
};

type Tab = "list" | "csv" | "recurring";

// view="recurring" で描画するブロック。銀行管理の「振替」タブは
// 口座間 資金フロー図 → 資金移動スケジュール → 取込済み明細の振替紐付け の順で並べるため、
// ページ側が必要なブロックだけを選べるようにしている（省略時は全部）。
type RecurringPart = "register" | "calendar" | "match";
const ALL_RECURRING_PARTS: RecurringPart[] = ["register", "calendar", "match"];

type Props = {
  /** 呼び出し側（銀行管理ページ）のタブで表示ビューを制御する。省略時はパネル内タブを出す */
  view?: Tab;
  /** ビュー切替を親へ通知する（明細一覧からカレンダーを開く導線で使う） */
  onViewChange?: (view: Tab) => void;
  /** 表示対象の口座を親から指定する（口座サマリのカード選択と連動させる） */
  accountId?: number | null;
  onAccountIdChange?: (id: number) => void;
  /** view="recurring" のとき描画するブロックと順序。省略時は全ブロック */
  recurringParts?: RecurringPart[];
  /**
   * 「振替を登録（銀行 → 銀行）」モーダルの開閉を親から制御する。
   * 渡された場合はパネル内の開くボタンを出さない（ページ側がボタンを持つ）。
   */
  bankTransferOpen?: boolean;
  onBankTransferOpenChange?: (open: boolean) => void;
};

// ── ページ ──────────────────────────────────────────────────────
export function BankTransactionsPanel({
  view,
  onViewChange,
  accountId: accountIdProp,
  onAccountIdChange,
  recurringParts = ALL_RECURRING_PARTS,
  bankTransferOpen: bankTransferOpenProp,
  onBankTransferOpenChange,
}: Props = {}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [innerTab, setInnerTab] = useState<Tab>("list");
  const tab = view ?? innerTab;
  const setTab = (t: Tab) => {
    setInnerTab(t);
    onViewChange?.(t);
  };
  const [innerAccountId, setInnerAccountId] = useState<number | null>(null);
  const accountId = accountIdProp !== undefined ? accountIdProp : innerAccountId;
  const setAccountId = (id: number) => {
    setInnerAccountId(id);
    setTxnPage(0);
    onAccountIdChange?.(id);
  };
  // 明細一覧のページ番号（0 始まり）
  const [txnPage, setTxnPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState(BLANK_MANUAL);
  const [recurring, setRecurring] = useState(BLANK_RECURRING);
  const [bankTransfer, setBankTransfer] = useState(BLANK_BANK_TRANSFER);
  // 振替登録モーダルの開閉。親から制御されていればそちらに従う
  const [innerBankTransferOpen, setInnerBankTransferOpen] = useState(false);
  const bankTransferOpen = bankTransferOpenProp ?? innerBankTransferOpen;
  const setBankTransferOpen = (open: boolean) => {
    setInnerBankTransferOpen(open);
    onBankTransferOpenChange?.(open);
  };
  // 取込済み明細の振替紐付け（案 C）: 許容する日付のずれと、処理中の候補
  const [matchDayGap, setMatchDayGap] = useState(3);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // カレンダー状態
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // ── データ取得 ──────────────────────────────────────────────
  // 資金フロー図は「銀行管理」（/bank-accounts）へ移設した。
  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> => {
      const list = ((await (await fetch("/api/bank-accounts")).json()).data ?? []) as BankAccount[];
      if (list.length && accountId === null) setAccountId(list[0].id);
      return list;
    },
  });

  // 振替候補は資金移動タブでのみ引く（全口座の未紐付け明細を突き合わせるため口座に依存しない）
  const { data: candidates } = useQuery({
    queryKey: ["transfer-candidates", matchDayGap],
    enabled: tab === "recurring",
    queryFn: async (): Promise<{ data: TransferCandidate[]; total: number }> => {
      const res = await fetch(`/api/bank-transfers/candidates?maxDayGap=${matchDayGap}`);
      const json = await res.json();
      return { data: json.data ?? [], total: json.total ?? 0 };
    },
  });

  const { data: txns } = useQuery({
    queryKey: ["bank-txns", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Txn[]> =>
      (await (await fetch(`/api/bank-accounts/${accountId}/transactions`)).json()).data ?? [],
  });

  // 明細一覧は 30 件ずつ表示する。口座切替や再取得で件数が減った場合は末尾ページへ丸める
  const txnTotal = txns?.length ?? 0;
  const txnPageCount = Math.max(1, Math.ceil(txnTotal / TXN_PAGE_SIZE));
  const currentTxnPage = Math.min(txnPage, txnPageCount - 1);
  const txnOffset = currentTxnPage * TXN_PAGE_SIZE;
  const pagedTxns = useMemo(
    () => (txns ?? []).slice(txnOffset, txnOffset + TXN_PAGE_SIZE),
    [txns, txnOffset],
  );

  const { data: categoryAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const categorizableAccounts = useMemo(
    () =>
      (categoryAccounts ?? []).filter((a) => ["REVENUE", "COGS", "EXPENSE"].includes(a.category)),
    [categoryAccounts],
  );

  const { data: allTransfers } = useQuery({
    queryKey: ["transfers"],
    queryFn: async (): Promise<Transfer[]> =>
      (await (await fetch("/api/transfers")).json()).data ?? [],
  });

  // カード引き落としの紐付け先（登録済みカード・電子マネー）
  const { data: cardAccounts } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<CardAccount[]> =>
      (await (await fetch("/api/linked-accounts")).json()).data ?? [],
  });

  // カレンダーの対象口座。"all" は全銀行分をまとめて表示する（口座別スケジュールの俯瞰用）
  const [calendarScope, setCalendarScope] = useState<number | "all" | null>(null);
  const scopeId = calendarScope ?? accountId;

  const transfers = useMemo(
    () =>
      (allTransfers ?? []).filter(
        (t) => scopeId === "all" || t.fromAccountId === scopeId || t.toAccountId === scopeId,
      ),
    [allTransfers, scopeId],
  );

  // 固定入出金の登録先口座。フォームで明示指定があればそれを、無ければカレンダーの対象口座に従う。
  // 対象口座が「すべての銀行」のときは登録先が決まらないため、フォーム側で選ばせる（null）。
  const recurringOwnerId =
    recurring.ownerAccountId !== ""
      ? Number(recurring.ownerAccountId)
      : typeof scopeId === "number"
        ? scopeId
        : null;

  // 全銀行表示のとき、資金移動が属する口座名を添える
  const accountNameOf = (t: Transfer) => {
    const id = t.fromAccountId ?? t.toAccountId;
    return (accounts ?? []).find((a) => a.id === id)?.name ?? "—";
  };

  const transfersByDay = useMemo(() => {
    const m = new Map<number, Transfer[]>();
    for (const t of transfers) {
      if (!m.has(t.day)) m.set(t.day, []);
      m.get(t.day)!.push(t);
    }
    return m;
  }, [transfers]);

  // カレンダー計算
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const selectedDayTransfers = selectedDay ? (transfersByDay.get(selectedDay) ?? []) : [];

  // ── ハンドラ ────────────────────────────────────────────────

  async function importFile(file: File) {
    if (accountId === null) {
      setImportError("口座を登録してください。");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      if (res.ok) {
        setImportResult((await res.json()) as ImportResult);
        qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
      } else {
        setImportError(await importErrorMessage(res));
      }
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

  async function sync() {
    if (accountId === null) {
      setImportError("口座を登録してください。");
      return;
    }
    setImportResult(null);
    setImportError(null);
    const res = await fetch(`/api/bank-accounts/${accountId}/sync`, { method: "POST" });
    const json = await res.json();
    if (res.ok) {
      setImportResult({ inserted: json.fetched ?? 0, errors: [] });
      qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    } else {
      setImportError("自動取得に失敗しました。");
    }
  }

  async function deleteTxn(t: Txn) {
    await fetch(`/api/bank-accounts/${accountId}/transactions?txnId=${t.id}`, {
      method: "DELETE",
    });
    if (t.transferGroupId) {
      // 振替は相手口座の明細も一緒に消えるため、全口座の明細と残高を取り直す
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["balance-trend"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
    } else {
      qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    }
  }

  async function setTxnCategory(txnId: number, categoryAccountId: number | null) {
    await fetch(`/api/bank-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId }),
    });
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  // ── 明細をチャージ（銀行 → デビット / プリペイド / 電子マネー）に指定する ───────
  // クレジットカードは後払いで残高を持たないためチャージ先に選べない
  // （カードの引き落としは「固定入出金」のカード引き落としで登録する）。
  const chargeTargets = useMemo(
    () => (cardAccounts ?? []).filter((c) => isChargeableType(c.type)),
    [cardAccounts],
  );
  // 明細 id -> 選択中のチャージ先（「指定」を押すまでは送らない）
  const [txnChargeTarget, setTxnChargeTarget] = useState<Record<number, string>>({});
  // 「指定」を押したときに開く紐付けモーダル（チャージ先の履歴から対になる明細を選ぶ）
  const [chargeLink, setChargeLink] = useState<{ txn: Txn; target: CardAccount } | null>(null);

  // チャージの指定・解除。pairTxnId を渡すとチャージ先に入った明細と対にする
  async function setTxnCharge(
    txnId: number,
    chargeToAccountId: number | null,
    pairTxnId: number | null = null,
  ) {
    const res = await fetch(`/api/bank-transactions/${txnId}/charge`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargeToAccountId, pairTxnId }),
    });
    if (res.ok) {
      setMsg(
        chargeToAccountId === null
          ? "チャージの指定を解除しました。科目の紐付け・転記ができるようになります。"
          : pairTxnId !== null
            ? "チャージ先の明細と紐付けました。両方とも収入・支出には計上されません。"
            : "チャージ（資金移動）に指定しました。収入・支出には計上されません。",
      );
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`変更に失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    // 紐付けた入金明細はカード側の明細なので、そちらも取り直す
    qc.invalidateQueries({ queryKey: ["card-txns"] });
    qc.invalidateQueries({ queryKey: ["charge-candidates"] });
    // 振替候補はチャージ指定済みの明細を除いて数えている
    qc.invalidateQueries({ queryKey: ["transfer-candidates"] });
  }

  async function postTxnToActuals(txnId: number) {
    const res = await fetch(`/api/bank-transactions/${txnId}/categorize`, {
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
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  async function submitManual(e: { preventDefault(): void }) {
    e.preventDefault();
    if (accountId === null) {
      setMsg("口座を登録してください。");
      return;
    }
    const rawAmt = Number(manual.amount);
    const amount = manual.type === "expense" ? -Math.abs(rawAmt) : Math.abs(rawAmt);
    const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
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
      qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
    } else setMsg("登録に失敗しました");
  }

  // 都度の銀行→銀行の振替。1 回の操作で出金元・入金先の両方に明細を作る
  // （片側だけ手入力すると相手口座の残高がずれるため、必ず API 側で対にして作る）。
  async function submitBankTransfer(e: { preventDefault(): void }) {
    e.preventDefault();
    const fromId = Number(bankTransfer.fromAccountId);
    const toId = Number(bankTransfer.toAccountId);
    if (!fromId || !toId) {
      setMsg("出金元と入金先の口座を選択してください。");
      return;
    }
    if (fromId === toId) {
      setMsg("出金元と入金先が同じです。別の口座を選択してください。");
      return;
    }
    const res = await fetch("/api/bank-transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: bankTransfer.date,
        fromAccountId: fromId,
        toAccountId: toId,
        amount: Number(bankTransfer.amount),
        description: bankTransfer.description || null,
      }),
    });
    if (res.ok) {
      // 日付は続けて登録しやすいよう残す
      setBankTransfer((b) => ({ ...BLANK_BANK_TRANSFER, date: b.date }));
      setMsg("振替を登録しました。出金元・入金先の両方の明細に反映されます。");
      // 両口座の明細と、残高を参照する画面（口座サマリ・残高推移・資金繰り）を更新する
      refreshAfterTransferChange();
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`振替の登録に失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  // 振替の紐付け・解除の後に、残高や収支を参照する画面をまとめて更新する
  function refreshAfterTransferChange() {
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
    qc.invalidateQueries({ queryKey: ["transfer-candidates"] });
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    qc.invalidateQueries({ queryKey: ["balance-trend"] });
    qc.invalidateQueries({ queryKey: ["funding-plan"] });
  }

  // 取込済みの 2 明細を後付けで振替として対にする（案 C）。明細は消えないので残高は変わらない。
  async function linkTransferCandidate(c: TransferCandidate) {
    const hasCategory = c.out.categoryAccountId !== null || c.in.categoryAccountId !== null;
    const confirmed = window.confirm(
      `次の 2 明細を振替として紐付けます。\n\n` +
        `出金 ${new Date(c.out.date).toLocaleDateString("ja-JP")} ${c.out.accountName}（${c.out.description}）\n` +
        `入金 ${new Date(c.in.date).toLocaleDateString("ja-JP")} ${c.in.accountName}（${c.in.description}）\n` +
        `金額 ${yen(c.amount)}\n\n` +
        `紐付けると収入・支出には計上されなくなります（口座残高は変わりません）。` +
        (hasCategory ? `\n付いている科目の紐付けは解除されます。` : ""),
    );
    if (!confirmed) return;

    const key = `${c.out.id}-${c.in.id}`;
    setLinkingKey(key);
    try {
      const res = await fetch("/api/bank-transfers/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outTxnId: c.out.id, inTxnId: c.in.id }),
      });
      if (res.ok) {
        setMsg("振替として紐付けました。両方の明細が収入・支出の集計から外れます。");
        refreshAfterTransferChange();
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg(`紐付けに失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
      }
    } finally {
      setLinkingKey(null);
    }
  }

  // 振替の紐付けを解除して独立した 2 明細に戻す（誤って紐付けたときの戻し道）
  async function unlinkTransfer(transferGroupId: string) {
    const confirmed = window.confirm(
      "この振替の紐付けを解除します。\n\n" +
        "明細は両方とも残るため口座残高は変わりませんが、以後それぞれ科目の紐付け・実績への転記ができるようになります。",
    );
    if (!confirmed) return;

    const res = await fetch(
      `/api/bank-transfers/link?transferGroupId=${encodeURIComponent(transferGroupId)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setMsg("振替の紐付けを解除しました。");
      refreshAfterTransferChange();
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`解除に失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  async function submitRecurring(e: { preventDefault(): void }) {
    e.preventDefault();
    // 登録先はカレンダーの対象口座（またはフォームでの明示指定）。
    // 「すべての銀行」表示のままだと登録先が決まらないので、口座を選ばせる。
    if (recurringOwnerId === null) {
      setMsg(
        (accounts ?? []).length === 0
          ? "口座を登録してください。"
          : "登録先の口座を選択してください。",
      );
      return;
    }
    // 銀行引き落とし・銀行振込で相手口座を選んだ場合は、この口座の反対側に据える（未選択なら外部）。
    // 銀行振込（BANK_TRANSFER）で相手に登録済み口座を選べば、from / to の両方が埋まった
    // 「毎月の銀行→銀行の振替」になる。
    const partnerId = PARTNER_ACCOUNT_CHANNELS.includes(recurring.channel)
      ? recurring.partnerAccountId
        ? Number(recurring.partnerAccountId)
        : null
      : null;
    const body = {
      fromAccountId: recurring.direction === "out" ? recurringOwnerId : partnerId,
      toAccountId: recurring.direction === "in" ? recurringOwnerId : partnerId,
      label: recurring.label || null,
      channel: recurring.channel,
      day: recurring.day,
      amount: Number(recurring.amount),
      note: recurring.note || null,
      kind: "AUTO",
      linkedAccountId:
        recurring.channel === "CARD_PAYMENT" && recurring.linkedAccountId
          ? Number(recurring.linkedAccountId)
          : null,
    };
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setRecurring((r) => ({ ...BLANK_RECURRING, day: r.day }));
      setMsg("追加しました");
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`追加に失敗しました: ${err.error ?? "エラー"}`);
    }
  }

  // ── 明細一覧から固定入出金（毎月の支払い項目）を登録する ─────────
  // 明細の「日」「金額」「摘要」をそのまま毎月の予定に写し、カレンダーへ反映する。
  const [txnChannel, setTxnChannel] = useState<Record<number, string>>({});
  const [txnCard, setTxnCard] = useState<Record<number, string>>({});

  // 既に登録済みの固定入出金を探す。「毎月◯日・同額・同じ摘要」の完全一致に加えて、
  // 摘要が一致するだけでも登録済みとみなす（同じ支払いが金額改定・日付変更されたケース）。
  // 一致した場合は登録ボタンではなく「書き換える」確認を出す。
  const normalizeLabel = (s: string) => s.trim().toLowerCase();
  const transferByKey = useMemo(() => {
    const m = new Map<string, Transfer>();
    for (const t of transfers) {
      m.set(`${t.day}:${Math.round(Number(t.amount))}:${normalizeLabel(t.label ?? "")}`, t);
    }
    return m;
  }, [transfers]);
  const transferByLabel = useMemo(() => {
    const m = new Map<string, Transfer>();
    for (const t of transfers) {
      const label = normalizeLabel(t.label ?? "");
      if (label && !m.has(label)) m.set(label, t);
    }
    return m;
  }, [transfers]);

  // この明細に対応する登録済みの固定入出金（無ければ null）
  function matchedTransfer(t: Txn): Transfer | null {
    const key = `${new Date(t.date).getDate()}:${Math.round(Math.abs(t.amount))}:${normalizeLabel(t.description)}`;
    return transferByKey.get(key) ?? transferByLabel.get(normalizeLabel(t.description)) ?? null;
  }

  // 登録済みの内容と明細の内容が違うか（違う場合だけ「書き換える」を出す）
  function differsFromTxn(tr: Transfer, t: Txn): boolean {
    return (
      tr.day !== new Date(t.date).getDate() ||
      Math.round(Number(tr.amount)) !== Math.round(Math.abs(t.amount))
    );
  }

  // 登録済みの固定入出金を、この明細の日付・金額・摘要で書き換える
  async function rewriteRecurringFromTxn(tr: Transfer, t: Txn) {
    const day = new Date(t.date).getDate();
    const amount = Math.round(Math.abs(t.amount));
    const ok = confirm(
      `「${tr.label ?? "（ラベルなし）"}」は毎月${tr.day}日・${yen(Number(tr.amount))}で登録済みです。\n` +
        `この明細の内容（毎月${day}日・${yen(amount)}）で書き換えますか？`,
    );
    if (!ok) return;
    const res = await fetch(`/api/transfers/${tr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, amount, label: t.description }),
    });
    if (res.ok) {
      setMsg(
        `毎月${day}日・${yen(amount)}に書き換えました。カレンダーと資金移動にも反映されます。`,
      );
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`書き換えに失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  function defaultChannel(t: Txn) {
    return txnChannel[t.id] ?? (t.amount < 0 ? "AUTO_DEBIT" : "INCOME");
  }

  async function registerRecurringFromTxn(t: Txn) {
    if (accountId === null) return;
    const channel = defaultChannel(t);
    const isOut = t.amount < 0;
    const cardId = txnCard[t.id];
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAccountId: isOut ? accountId : null,
        toAccountId: isOut ? null : accountId,
        label: t.description,
        channel,
        day: new Date(t.date).getDate(),
        amount: Math.abs(t.amount),
        kind: "AUTO",
        linkedAccountId: channel === "CARD_PAYMENT" && cardId ? Number(cardId) : null,
      }),
    });
    if (res.ok) {
      setMsg(
        `毎月${new Date(t.date).getDate()}日の${CHANNEL_LABELS[channel] ?? channel}として登録しました。カレンダーにも表示されます。`,
      );
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`登録に失敗しました: ${err.error ?? "エラー"}`);
    }
  }

  // 明細の日付を資金移動タブのカレンダーで開く（登録済みの固定入出金を確認する導線）
  function openInCalendar(t: Txn) {
    const d = new Date(t.date);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
    setSelectedDay(d.getDate());
    setRecurring((r) => ({ ...r, day: d.getDate() }));
    setTab("recurring");
  }

  async function deleteTransfer(id: number) {
    await fetch(`/api/transfers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["transfer-flow"] });
  }

  function prevCalMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else setViewMonth((m) => m - 1);
  }
  function nextCalMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else setViewMonth((m) => m + 1);
  }

  function selectCalDay(day: number) {
    setSelectedDay(day);
    setRecurring((r) => ({ ...r, day }));
  }

  const selectedAccount = accounts?.find((a) => a.id === accountId);
  const TABS: [Tab, string][] = [
    ["list", "明細一覧"],
    ["recurring", "カレンダー"],
    ["csv", "CSV インポート"],
  ];

  return (
    <>
      {/* ヘッダ */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="input-field w-60 ml-auto"
          value={accountId ?? ""}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{a.bankName}）
            </option>
          ))}
        </select>
      </div>

      {accounts && accounts.length === 0 && (
        <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 flex items-center justify-between gap-3">
          <span>口座が登録されていません。入出金を記録するには、先に口座を登録してください。</span>
          <Link
            href="/bank-accounts"
            className="shrink-0 text-amber-900 font-medium underline underline-offset-2 hover:text-amber-700"
          >
            口座を登録する
          </Link>
        </div>
      )}

      {/* タブ（銀行管理ページ側でタブを持つ場合は出さない） */}
      {view === undefined && (
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
              {t === "recurring" && transfers.length > 0 && (
                <span className="ml-1.5 text-xs bg-slate-200 text-slate-600 rounded-full px-1.5">
                  {transfers.length}
                </span>
              )}
            </button>
          ))}
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

      {/* ── 明細一覧タブ ─────────────────────────────────────── */}
      {tab === "list" && (
        <>
          {/* 手動登録フォーム */}
          <div className="card mb-4">
            <h2 className="section-title mb-3">入出金を手動登録</h2>
            <form onSubmit={submitManual} className="flex flex-wrap gap-3 items-end">
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-sm h-9 self-end">
                {(["expense", "income"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setManual((m) => ({ ...m, type: d }))}
                    className={`px-3 font-medium transition-colors ${manual.type === d ? (d === "expense" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  >
                    {d === "expense" ? "支出" : "収入"}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">日付</label>
                <input
                  type="date"
                  required
                  value={manual.date}
                  onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-40">
                <label className="text-xs text-slate-500">摘要</label>
                <input
                  type="text"
                  required
                  placeholder="例: 食料品"
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

          {txnTotal > 0 && (
            <p className="text-xs text-slate-500 mb-3">
              全 {txnTotal} 件中 {txnOffset + 1}〜{Math.min(txnOffset + TXN_PAGE_SIZE, txnTotal)}{" "}
              件を表示
            </p>
          )}

          {/* 明細テーブル（列が多いので横スクロールさせる。固定幅にしないと右端の列が切れる） */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[72rem]">
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
                      "固定入出金",
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
                    // 摘要が一致する固定入出金があれば「登録済み」表示に切り替える
                    const registered = matchedTransfer(t);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 group">
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                          {new Date(t.date).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-4 py-2.5">{t.description}</td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                        >
                          {yen(t.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* 口座間振替は自己資金の移動なので科目に紐付けない（二重計上の防止） */}
                          {t.transferGroupId ? (
                            <span className="relative inline-flex items-center gap-1 group/transfer">
                              <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                振替
                              </span>
                              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/transfer:block">
                                {TRANSFER_HELP_TEXT}
                              </span>
                              {/* 誤って紐付けた場合の戻し道。明細は残るので残高は変わらない */}
                              <button
                                onClick={() => unlinkTransfer(t.transferGroupId!)}
                                className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap"
                              >
                                解除
                              </button>
                            </span>
                          ) : t.chargeToAccountId ? (
                            // チャージも自己資金の移動。実際の支出はチャージ先の利用明細で計上する
                            <span className="relative inline-flex items-center gap-1 group/charge">
                              <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                チャージ
                              </span>
                              <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/charge:block">
                                {t.chargeToAccount
                                  ? `${t.chargeToAccount.name} へのチャージ。${CHARGE_HELP_TEXT}`
                                  : CHARGE_HELP_TEXT}
                              </span>
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
                          {t.transferGroupId || t.chargeToAccountId ? (
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
                        {/* チャージ先（デビット・プリペイド・電子マネー）の指定・解除 */}
                        <td className="px-4 py-2.5">
                          {t.chargeToAccountId ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600 whitespace-nowrap">
                                {t.chargeToAccount?.name ?? "指定済み"}
                              </span>
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
                                onClick={() => setTxnCharge(t.id, null)}
                                className="text-xs text-slate-400 hover:text-red-600 text-left whitespace-nowrap"
                              >
                                解除
                              </button>
                            </div>
                          ) : t.transferGroupId || t.postedRecordId !== null ? (
                            // 振替として紐付け済み・転記済みの明細は先にそちらを外す必要がある
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : t.amount >= 0 ? (
                            // チャージは口座からの出金。入金明細は対象にならない
                            <span className="text-xs text-slate-300">—</span>
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
                                {chargeTargets.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}（
                                    {LINKED_ACCOUNT_TYPE_LABELS[c.type as LinkedAccountType] ??
                                      c.type}
                                    ）
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => {
                                  const target = chargeTargets.find(
                                    (c) => c.id === Number(txnChargeTarget[t.id]),
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
                        <td className="px-4 py-2.5">
                          {t.transferGroupId || t.chargeToAccountId ? (
                            // 振替は毎月の固定入出金として登録しない（登録するなら資金移動ルール側で
                            // 「銀行振込」＋相手口座を指定する）
                            <span className="text-xs text-slate-400">対象外</span>
                          ) : registered ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded whitespace-nowrap">
                                  登録済み
                                </span>
                                <button
                                  onClick={() => openInCalendar(t)}
                                  className="text-xs text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
                                >
                                  カレンダー
                                </button>
                              </div>
                              {/* 摘要は一致するが日付・金額が違う場合は書き換えを確認する */}
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
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <select
                                value={defaultChannel(t)}
                                onChange={(e) =>
                                  setTxnChannel((m) => ({ ...m, [t.id]: e.target.value }))
                                }
                                className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-28"
                              >
                                {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                                  <option key={v} value={v}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                              {defaultChannel(t) === "CARD_PAYMENT" && (
                                <select
                                  value={txnCard[t.id] ?? ""}
                                  onChange={(e) =>
                                    setTxnCard((m) => ({ ...m, [t.id]: e.target.value }))
                                  }
                                  className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-28"
                                >
                                  <option value="">カード未紐付け</option>
                                  {(cardAccounts ?? []).map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button
                                onClick={() => registerRecurringFromTxn(t)}
                                className="text-xs text-indigo-600 hover:text-indigo-700 text-left"
                              >
                                登録する
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            onClick={() => deleteTxn(t)}
                            className="opacity-0 group-hover:opacity-100 text-xs text-slate-300 hover:text-red-500 transition-opacity"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {txnTotal === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                        明細がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {txnTotal > TXN_PAGE_SIZE && (
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

          <div className="card flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">自動取得（同期）</p>
              <p className="text-xs text-slate-400 mt-0.5">口座と連携して最新の明細を取得します</p>
            </div>
            <button onClick={sync} className="btn-secondary px-4 py-2 text-sm whitespace-nowrap">
              同期する
            </button>
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
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`date,description,amount,balance
2026-06-25,給与振込,450000,520000
2026-06-28,家賃,-90000,430000
2026-06-30,電気代,-8500,`}</pre>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li>
                <span className="font-medium">date</span>：取引日（YYYY-MM-DD）
              </li>
              <li>
                <span className="font-medium">description</span>：摘要
              </li>
              <li>
                <span className="font-medium">amount</span>：金額（収入は正、支出は負）
              </li>
              <li>
                <span className="font-medium">balance</span>
                ：取引後残高（任意。列があっても取込は通りますが、明細一覧には表示しません）
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── 固定の入出金（資金移動スケジュール）───────────────── */}
      {tab === "recurring" && (
        <>
          {/* ── 都度の振替（銀行 → 銀行）─────────────────────────
              出金元・入金先の両方に明細を作るので、片側だけ手入力して残高がずれることがない。
              毎月決まった振替はカレンダーから「銀行振込」＋相手口座で登録する。
              入力欄は常時出さずモーダルに収める（ボタンはページ側が持つこともある）。 */}
          {recurringParts.includes("register") && bankTransferOpenProp === undefined && (
            <div className="flex justify-end mb-4">
              <button
                type="button"
                onClick={() => setBankTransferOpen(true)}
                disabled={(accounts ?? []).length < 2}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-40"
                title={
                  (accounts ?? []).length < 2
                    ? "振替には 2 つ以上の口座の登録が必要です"
                    : undefined
                }
              >
                振替を登録（銀行 → 銀行）
              </button>
            </div>
          )}
          {recurringParts.includes("register") && bankTransferOpen && (
            <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl my-auto">
                <h2 className="text-lg font-bold text-slate-800 mb-1">振替を登録（銀行 → 銀行）</h2>
                <p className="text-xs text-slate-500 mb-4">
                  両方の口座に明細を作ります。自己資金の移動なので収入・支出には計上されません。
                </p>
                <form onSubmit={submitBankTransfer} className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">日付</label>
                    <input
                      type="date"
                      required
                      value={bankTransfer.date}
                      onChange={(e) => setBankTransfer((b) => ({ ...b, date: e.target.value }))}
                      className="input-field text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-44">
                    <label className="text-xs text-slate-500">出金元の口座</label>
                    <select
                      required
                      value={bankTransfer.fromAccountId}
                      onChange={(e) =>
                        setBankTransfer((b) => ({ ...b, fromAccountId: e.target.value }))
                      }
                      className="input-field text-sm"
                    >
                      <option value="">選択してください</option>
                      {(accounts ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{a.bankName}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-slate-400 pb-2">→</span>
                  <div className="flex flex-col gap-1 min-w-44">
                    <label className="text-xs text-slate-500">入金先の口座</label>
                    <select
                      required
                      value={bankTransfer.toAccountId}
                      onChange={(e) =>
                        setBankTransfer((b) => ({ ...b, toAccountId: e.target.value }))
                      }
                      className="input-field text-sm"
                    >
                      <option value="">選択してください</option>
                      {(accounts ?? [])
                        .filter((a) => String(a.id) !== bankTransfer.fromAccountId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}（{a.bankName}）
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 w-36">
                    <label className="text-xs text-slate-500">金額（円）</label>
                    <input
                      type="number"
                      required
                      min={1}
                      placeholder="例: 50000"
                      value={bankTransfer.amount}
                      onChange={(e) => setBankTransfer((b) => ({ ...b, amount: e.target.value }))}
                      className="input-field text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-40">
                    <label className="text-xs text-slate-500">摘要（任意）</label>
                    <input
                      type="text"
                      placeholder="未入力なら相手口座名から自動作成"
                      value={bankTransfer.description}
                      onChange={(e) =>
                        setBankTransfer((b) => ({ ...b, description: e.target.value }))
                      }
                      className="input-field text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 self-end ml-auto">
                    <button
                      type="button"
                      onClick={() => setBankTransferOpen(false)}
                      className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      disabled={(accounts ?? []).length < 2}
                      className="btn-primary px-5 py-2 text-sm disabled:opacity-40"
                    >
                      振替を登録
                    </button>
                  </div>
                  {(accounts ?? []).length < 2 && (
                    <span className="text-xs text-slate-400 self-end pb-2">
                      振替には 2 つ以上の口座の登録が必要です。
                    </span>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* ── 資金移動カレンダー（スケジュールモード）─────────────── */}
          {recurringParts.includes("calendar") && (
            <>
              {/* 対象口座の切替。「すべての銀行」で全口座の移動スケジュールを俯瞰できる */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-slate-600">対象口座</label>
                <select
                  value={scopeId === "all" ? "all" : (scopeId ?? "")}
                  onChange={(e) => {
                    setCalendarScope(e.target.value === "all" ? "all" : Number(e.target.value));
                    setSelectedDay(null);
                    // 追加フォームの登録先・相手先は対象口座に追従させる（前の口座の指定を持ち越さない）
                    setRecurring((r) => ({ ...r, ownerAccountId: "", partnerAccountId: "" }));
                  }}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">すべての銀行</option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}（{a.bankName}）
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">
                  {scopeId === "all"
                    ? `全 ${(accounts ?? []).length} 口座の資金移動 ${transfers.length} 件を表示しています`
                    : `この口座の資金移動 ${transfers.length} 件を表示しています`}
                </span>
              </div>
              <div className="flex gap-4 items-start">
                {/* 左: カレンダー */}
                <div className="card flex-1 min-w-0 p-0 overflow-hidden">
                  {/* 月ナビ */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <button
                      onClick={prevCalMonth}
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
                      onClick={nextCalMonth}
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

                  {/* 曜日ヘッダ */}
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

                  {/* カレンダーグリッド */}
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
                      const dayTxs = isValid ? (transfersByDay.get(day) ?? []) : [];
                      const weekday = i % 7;
                      return (
                        <button
                          key={i}
                          disabled={!isValid}
                          onClick={() => isValid && selectCalDay(day)}
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
                              {dayTxs.slice(0, 2).map((t) => {
                                // 横の一覧と同じ判定（全銀行表示では出金元の有無で向きを決める）
                                const isOut =
                                  scopeId === "all"
                                    ? t.fromAccountId !== null
                                    : t.fromAccountId === scopeId;
                                return (
                                  <p
                                    key={t.id}
                                    className={`text-[10px] truncate leading-tight ${isOut ? "text-rose-600" : "text-emerald-600"}`}
                                  >
                                    {isOut ? "−" : "+"}
                                    {t.label ?? CHANNEL_LABELS[t.channel] ?? t.channel}
                                  </p>
                                );
                              })}
                              {dayTxs.length > 2 && (
                                <p className="text-[9px] text-slate-400">他{dayTxs.length - 2}件</p>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 右: サイドパネル */}
                <div className="w-80 shrink-0 flex flex-col gap-3">
                  {selectedDay ? (
                    <>
                      {/* 日付ヘッダー */}
                      <div className="card py-2 px-4">
                        <p className="text-sm font-semibold text-slate-800">
                          毎月{selectedDay}日 — {selectedAccount?.name ?? "この口座"}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {selectedDayTransfers.length} 件の固定入出金
                        </p>
                      </div>

                      {/* その日の一覧 */}
                      {selectedDayTransfers.length > 0 && (
                        <div className="card p-0 overflow-hidden">
                          <ul className="divide-y divide-slate-100">
                            {selectedDayTransfers.map((t) => {
                              // 全銀行表示では基準口座が定まらないため、出金元の有無で向きを判定する
                              const isOut =
                                scopeId === "all"
                                  ? t.fromAccountId !== null
                                  : t.fromAccountId === scopeId;
                              const partner = isOut ? t.toAccount : t.fromAccount;
                              return (
                                <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-800 truncate">
                                      {t.label ?? "—"}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                      {scopeId === "all" && (
                                        <span className="text-indigo-500">
                                          {accountNameOf(t)} ·{" "}
                                        </span>
                                      )}
                                      {CHANNEL_LABELS[t.channel] ?? t.channel}
                                      {t.linkedAccount
                                        ? " · " + t.linkedAccount.name
                                        : partner?.name
                                          ? " · " + partner.name
                                          : " · 外部"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`text-xs font-semibold ${isOut ? "text-rose-600" : "text-emerald-600"}`}
                                    >
                                      {isOut ? "−" : "+"}
                                      {yen(Number(t.amount))}
                                    </span>
                                    <button
                                      onClick={() => deleteTransfer(t.id)}
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

                      {/* 追加フォーム */}
                      <div className="card">
                        <h3 className="text-xs font-semibold text-slate-600 mb-3">
                          毎月{selectedDay}日 の入出金を追加
                        </h3>
                        <form onSubmit={submitRecurring} className="flex flex-col gap-2.5">
                          {/* 登録先の口座。カレンダーの対象口座に追従し、ここで変更もできる。
                        「すべての銀行」表示のままだと登録先が決まらないため必須にする。 */}
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500">
                              登録先の口座（この口座の入出金として登録）
                            </label>
                            <select
                              value={recurringOwnerId === null ? "" : String(recurringOwnerId)}
                              onChange={(e) =>
                                setRecurring((r) => ({
                                  ...r,
                                  ownerAccountId: e.target.value,
                                  // 登録先を変えたら、同じ口座が相手先に残らないようにする
                                  partnerAccountId:
                                    r.partnerAccountId === e.target.value ? "" : r.partnerAccountId,
                                }))
                              }
                              className="input-field text-xs"
                            >
                              <option value="">選択してください</option>
                              {(accounts ?? []).map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}（{a.bankName}）
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                            {(["out", "in"] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setRecurring((r) => ({ ...r, direction: d }))}
                                className={`flex-1 py-1.5 font-medium transition-colors ${recurring.direction === d ? (d === "out" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}
                              >
                                {d === "out" ? "出金（支払）" : "入金（受取）"}
                              </button>
                            ))}
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500">ラベル（任意）</label>
                            <input
                              type="text"
                              placeholder="例: 家賃・給与振込"
                              value={recurring.label}
                              onChange={(e) =>
                                setRecurring((r) => ({ ...r, label: e.target.value }))
                              }
                              className="input-field text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500">種別</label>
                            <select
                              value={recurring.channel}
                              onChange={(e) =>
                                setRecurring((r) => ({ ...r, channel: e.target.value }))
                              }
                              className="input-field text-xs"
                            >
                              {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* 銀行引き落とし・銀行振込: お金の相手先（登録先口座の反対側）を紐付ける。
                        登録先口座そのものは相手先になり得ないため候補から外す。
                        銀行振込で相手に登録済み口座を選ぶと、毎月の銀行→銀行の振替になる。 */}
                          {PARTNER_ACCOUNT_CHANNELS.includes(recurring.channel) && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-slate-500">
                                {recurring.direction === "out"
                                  ? recurring.channel === "BANK_TRANSFER"
                                    ? "相手先の口座＝振込先（任意）"
                                    : "相手先の口座＝引き落とし先（任意）"
                                  : recurring.channel === "BANK_TRANSFER"
                                    ? "相手先の口座＝振込元（任意）"
                                    : "相手先の口座＝入金元（任意）"}
                              </label>
                              <select
                                value={recurring.partnerAccountId}
                                onChange={(e) =>
                                  setRecurring((r) => ({ ...r, partnerAccountId: e.target.value }))
                                }
                                className="input-field text-xs"
                              >
                                <option value="">外部（登録口座以外）</option>
                                {(accounts ?? [])
                                  .filter((a) => a.id !== recurringOwnerId)
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}（{a.bankName}）
                                    </option>
                                  ))}
                              </select>
                              <span className="text-[10px] text-slate-400">
                                {recurring.channel === "BANK_TRANSFER"
                                  ? "登録済みの口座を選ぶと、毎月の銀行→銀行の振替として両方の口座に反映されます。相手が登録口座以外なら「外部」のままで構いません。"
                                  : recurring.direction === "out"
                                    ? "上の「登録先の口座」から引き落とされます。相手が登録口座以外（家賃・公共料金など）なら「外部」のままで構いません。"
                                    : "上の「登録先の口座」へ入金されます。振込元が登録口座以外（給与など）なら「外部」のままで構いません。"}
                              </span>
                            </div>
                          )}
                          {/* カード引き落とし: 登録済みカード・電子マネーを紐付ける */}
                          {recurring.channel === "CARD_PAYMENT" && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-slate-500">
                                紐付けるカード・電子マネー
                              </label>
                              <select
                                value={recurring.linkedAccountId}
                                onChange={(e) =>
                                  setRecurring((r) => ({ ...r, linkedAccountId: e.target.value }))
                                }
                                className="input-field text-xs"
                              >
                                <option value="">未紐付け</option>
                                {(cardAccounts ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}（{c.institution}）
                                  </option>
                                ))}
                              </select>
                              {(cardAccounts ?? []).length === 0 && (
                                <span className="text-[10px] text-slate-400">
                                  「カード・電子マネー管理」でカードを登録すると選べます。
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500">金額（円）</label>
                            <input
                              type="number"
                              min={1}
                              required
                              placeholder="例: 90000"
                              value={recurring.amount}
                              onChange={(e) =>
                                setRecurring((r) => ({ ...r, amount: e.target.value }))
                              }
                              className="input-field text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500">メモ（任意）</label>
                            <input
                              type="text"
                              placeholder="備考"
                              value={recurring.note}
                              onChange={(e) =>
                                setRecurring((r) => ({ ...r, note: e.target.value }))
                              }
                              className="input-field text-xs"
                            />
                          </div>
                          <button type="submit" className="btn-primary text-xs py-2 mt-1">
                            追加
                          </button>
                        </form>
                      </div>
                    </>
                  ) : (
                    <div className="card text-center py-8">
                      <p className="text-sm text-slate-400">
                        カレンダーの日付をクリックして
                        <br />
                        固定の入出金を確認・追加
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── 取込済み明細の振替紐付け（案 C）─────────────────────
              両口座の CSV を別々に取り込むと 1 回の資金移動が 2 明細に分かれて入る。
              対にしておかないと収入・支出として二重計上されるため、候補を突き合わせて紐付ける。 */}
          {recurringParts.includes("match") && (
            <div className="card mb-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
                <h3 className="text-xs font-semibold text-slate-600">取込済み明細の振替紐付け</h3>
                <span className="relative inline-flex items-center group/match">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                  <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-80 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg group-hover/match:block">
                    {TRANSFER_MATCH_HELP_TEXT}
                  </span>
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <label className="text-xs text-slate-500">日付のずれ</label>
                  <select
                    value={matchDayGap}
                    onChange={(e) => setMatchDayGap(Number(e.target.value))}
                    className="input-field text-sm py-1"
                  >
                    {DAY_GAP_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? "同じ日のみ" : `${d}日以内`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {candidates === undefined ? (
                <p className="text-xs text-slate-400">候補を探しています…</p>
              ) : candidates.data.length === 0 ? (
                <p className="text-xs text-slate-400">
                  振替の対になりそうな明細は見つかりませんでした。着金が数日ずれている場合は「日付のずれ」を広げてみてください。
                </p>
              ) : (
                <>
                  <p className="text-[10px] text-slate-400 mb-2">
                    同額・符号が逆・別口座の明細の組です（{candidates.total} 件
                    {candidates.total > candidates.data.length &&
                      `のうち ${candidates.data.length} 件を表示`}
                    ）。機械的な突き合わせなので、内容を確かめてから紐付けてください。
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                            出金
                          </th>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                            入金
                          </th>
                          <th className="text-right px-3 py-2 font-medium whitespace-nowrap">
                            金額
                          </th>
                          <th className="text-center px-3 py-2 font-medium whitespace-nowrap">
                            日付のずれ
                          </th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {candidates.data.map((c) => {
                          const key = `${c.out.id}-${c.in.id}`;
                          return (
                            <tr key={key} className="hover:bg-slate-50/60">
                              <td className="px-3 py-2 align-top">
                                <div className="text-xs text-slate-500 whitespace-nowrap">
                                  {new Date(c.out.date).toLocaleDateString("ja-JP")}・
                                  {c.out.accountName}
                                </div>
                                <div className="text-slate-700">{c.out.description}</div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="text-xs text-slate-500 whitespace-nowrap">
                                  {new Date(c.in.date).toLocaleDateString("ja-JP")}・
                                  {c.in.accountName}
                                </div>
                                <div className="text-slate-700">{c.in.description}</div>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums align-top whitespace-nowrap">
                                {yen(c.amount)}
                              </td>
                              <td className="px-3 py-2 text-center align-top whitespace-nowrap text-xs text-slate-500">
                                {c.dayGap === 0 ? "同じ日" : `${c.dayGap}日`}
                              </td>
                              <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                                <button
                                  onClick={() => linkTransferCandidate(c)}
                                  disabled={linkingKey !== null}
                                  className="text-xs text-indigo-600 hover:text-indigo-700 disabled:text-slate-300 disabled:cursor-not-allowed"
                                >
                                  {linkingKey === key ? "紐付け中…" : "振替として紐付ける"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
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
            setTxnCharge(chargeLink.txn.id, chargeLink.target.id, pairTxnId);
            setChargeLink(null);
          }}
        />
      )}
    </>
  );
}
