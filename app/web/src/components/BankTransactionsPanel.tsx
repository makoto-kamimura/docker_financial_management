"use client";

// 入出金管理のパネル。ページ（/bank-transactions）から「銀行管理」のタブへ移設した。
// AppShell とページ見出しは呼び出し側（/bank-accounts）が持つ。

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { ChargeLinkModal } from "@/components/ChargeLinkModal";
import { InfoNote, SectionLead, TermDetails } from "@/components/Explain";
import { BANK_HELP, BANK_TERMS } from "@/lib/help-texts";
import { isChargeableType, LINKED_ACCOUNT_TYPE_LABELS } from "@/lib/linked-account-type";
import type { LinkedAccountType } from "@/lib/linked-account-type";
import {
  TRANSFER_CHANNEL_LABELS as CHANNEL_LABELS,
  TXN_SOURCE_LABEL as SOURCE_LABELS,
} from "@/lib/labels";
import { CsvDropzone, Notice, Pager, Tabs } from "@/components/ui";

// ── 型 ──────────────────────────────────────────────────────────
type BankAccount = { id: number; name: string; bankName: string; role: string };
type CategoryAccount = { id: number; code: string; name: string; category: string };
type Txn = {
  id: number;
  accountId: number;
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

// 明細一覧のページング（実績管理の履歴と同じ 30 件単位）
const TXN_PAGE_SIZE = 30;

// 口座間振替（都度）の登録フォーム。出金元・入金先の 2 口座に明細を 1 操作で作る
const BLANK_BANK_TRANSFER = {
  date: now.toISOString().slice(0, 10),
  fromAccountId: "" as string,
  toAccountId: "" as string,
  amount: "",
  description: "",
};

// 振替候補の日付のずれの選択肢（他行宛の振込は着金が翌営業日以降になることがある）
const DAY_GAP_OPTIONS = [0, 1, 3, 7] as const;

type Tab = "list" | "csv" | "recurring";

// view="recurring" で描画するブロック。register＝振替（銀行 → 銀行）の登録モーダル、
// match＝取込済み明細の振替紐付け。実績管理の履歴（出どころは銀行）で、必要なブロックだけを選んで使う。
type RecurringPart = "register" | "match";
const ALL_RECURRING_PARTS: RecurringPart[] = ["register", "match"];

type Props = {
  /** 呼び出し側（銀行管理ページ）のタブで表示ビューを制御する。省略時はパネル内タブを出す */
  view?: Tab;
  /** ビュー切替を親へ通知する */
  onViewChange?: (view: Tab) => void;
  /**
   * 表示対象の口座を親から指定する（銀行管理の「表示する銀行」カード）。null はすべての口座。
   * 渡された場合はパネル内の口座セレクタを出さない。省略時はパネル内で選ぶ（最初の口座を既定にする）。
   */
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

  // ── データ取得 ──────────────────────────────────────────────
  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> => {
      const list = ((await (await fetch("/api/bank-accounts")).json()).data ?? []) as BankAccount[];
      if (accountIdProp === undefined && list.length && accountId === null)
        setAccountId(list[0].id);
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

  // 明細は口座ごとに取る。すべての口座のときは全口座分を日付の新しい順にまとめる
  const allAccountsView = accountId === null;
  const txnAccountIds = allAccountsView ? (accounts ?? []).map((a) => a.id) : [accountId];
  const txnQueries = useQueries({
    queries: txnAccountIds.map((id) => ({
      queryKey: ["bank-txns", id],
      queryFn: async (): Promise<Txn[]> =>
        (await (await fetch(`/api/bank-accounts/${id}/transactions`)).json()).data ?? [],
    })),
  });
  const txnsKey = txnQueries.map((q) => q.dataUpdatedAt).join(",");
  const txns = useMemo(
    () =>
      txnQueries
        .flatMap((q) => q.data ?? [])
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)),
    // 各口座の取得結果が変わったときだけまとめ直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txnsKey],
  );
  const accountNameById = (id: number) => accounts?.find((a) => a.id === id)?.name ?? "";

  // CSV 取込・自動取得の取り込み先。すべての口座を表示しているときは CSV の欄で選ぶ
  const [importTargetId, setImportTargetId] = useState<number | null>(null);
  const importAccountId = accountId ?? importTargetId;

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

  // 固定入出金の照合に使う口座。呼び出し側から口座を渡されたときは、その選択（null はすべての銀行）に従う
  const scopeId: number | "all" | null =
    accountIdProp !== undefined ? (accountIdProp ?? "all") : accountId;

  const transfers = useMemo(
    () =>
      (allTransfers ?? []).filter(
        (t) => scopeId === "all" || t.fromAccountId === scopeId || t.toAccountId === scopeId,
      ),
    [allTransfers, scopeId],
  );

  // ── ハンドラ ────────────────────────────────────────────────

  async function importFile(file: File) {
    if (importAccountId === null) {
      setImportError(
        (accounts ?? []).length === 0
          ? "口座を登録してください。"
          : "取り込み先の口座を選んでください。",
      );
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
      const res = await fetch(`/api/bank-accounts/${importAccountId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      if (res.ok) {
        setImportResult((await res.json()) as ImportResult);
        qc.invalidateQueries({ queryKey: ["bank-txns"] });
      } else {
        setImportError(await importErrorMessage(res));
      }
    } catch {
      setImportError(importNetworkErrorMessage);
    } finally {
      setImporting(false);
    }
  }

  async function sync() {
    if (importAccountId === null) {
      setImportError(
        (accounts ?? []).length === 0
          ? "口座を登録してください。"
          : "取り込み先の口座を選んでください。",
      );
      return;
    }
    setImportResult(null);
    setImportError(null);
    const res = await fetch(`/api/bank-accounts/${importAccountId}/sync`, { method: "POST" });
    const json = await res.json();
    if (res.ok) {
      setImportResult({ inserted: json.fetched ?? 0, errors: [] });
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
    } else {
      setImportError("自動取得に失敗しました。");
    }
  }

  async function deleteTxn(t: Txn) {
    await fetch(`/api/bank-accounts/${t.accountId}/transactions?txnId=${t.id}`, {
      method: "DELETE",
    });
    if (t.transferGroupId) {
      // 振替は相手口座の明細も一緒に消えるため、全口座の明細と残高を取り直す
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
      qc.invalidateQueries({ queryKey: ["cash-outlook"] });
    } else {
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
    }
  }

  async function setTxnCategory(txnId: number, categoryAccountId: number | null) {
    await fetch(`/api/bank-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId }),
    });
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
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
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
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
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
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
      // 両口座の明細と、残高を参照する画面（銀行口座・残高の推移）を更新する
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
    qc.invalidateQueries({ queryKey: ["funding-plan"] });
    qc.invalidateQueries({ queryKey: ["cash-outlook"] });
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

  // ── 明細一覧から固定入出金（毎月の支払い項目）を登録する ─────────
  // 明細の「日」「金額」「摘要」をそのまま毎月の予定に写す（残高の推移の見込みに入る）。
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
      setMsg(`毎月${day}日・${yen(amount)}に書き換えました。残高の推移の見込みにも反映されます。`);
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
      qc.invalidateQueries({ queryKey: ["transfer-suggestions"] });
      qc.invalidateQueries({ queryKey: ["funding-plan"] });
      qc.invalidateQueries({ queryKey: ["cash-outlook"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`書き換えに失敗しました: ${typeof err.error === "string" ? err.error : "エラー"}`);
    }
  }

  function defaultChannel(t: Txn) {
    return txnChannel[t.id] ?? (t.amount < 0 ? "AUTO_DEBIT" : "INCOME");
  }

  async function registerRecurringFromTxn(t: Txn) {
    const channel = defaultChannel(t);
    const isOut = t.amount < 0;
    const cardId = txnCard[t.id];
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAccountId: isOut ? t.accountId : null,
        toAccountId: isOut ? null : t.accountId,
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
        `毎月${new Date(t.date).getDate()}日の${CHANNEL_LABELS[channel] ?? channel}として登録しました。残高の推移の見込みに入ります。`,
      );
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["transfer-flow"] });
      qc.invalidateQueries({ queryKey: ["transfer-suggestions"] });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`登録に失敗しました: ${err.error ?? "エラー"}`);
    }
  }

  async function deleteTransfer(id: number) {
    await fetch(`/api/transfers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["transfer-flow"] });
    qc.invalidateQueries({ queryKey: ["transfer-suggestions"] });
  }

  const TABS: [Tab, string][] = [
    ["list", "一覧"],
    ["recurring", "毎月の入出金"],
    ["csv", "CSV インポート"],
  ];

  return (
    <>
      {/* ヘッダ（銀行管理から口座を渡されたときは、ページの「表示する銀行」カードで選ぶので出さない） */}
      {accountIdProp === undefined && (
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
      )}

      {/* 口座が無いときの案内（毎月の入出金のブロックと明細の一覧を並べるときに二重に出さない） */}
      {accounts && accounts.length === 0 && tab !== "recurring" && (
        <Notice tone="warn" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <span>
              口座が登録されていません。入出金を記録するには、先に口座を登録してください。
            </span>
            <Link
              href="/bank-accounts"
              className="shrink-0 text-amber-900 font-medium underline underline-offset-2 hover:text-amber-700"
            >
              口座を登録する
            </Link>
          </div>
        </Notice>
      )}

      {/* タブ（銀行管理ページ側でタブを持つ場合は出さない） */}
      {view === undefined && (
        <Tabs
          tabs={TABS.map(
            ([t, label]) =>
              [
                t,
                <>
                  {label}
                  {t === "recurring" && transfers.length > 0 && (
                    <span className="ml-1.5 text-xs bg-slate-200 text-slate-600 rounded-full px-1.5">
                      {transfers.length}
                    </span>
                  )}
                </>,
              ] as const,
          )}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setMsg(null);
          }}
          className="mb-4"
        />
      )}

      {msg && (
        <Notice tone="info" onClose={() => setMsg(null)} className="mb-4">
          {msg}
        </Notice>
      )}

      {/* ── 明細一覧タブ ─────────────────────────────────────── */}
      {tab === "list" && (
        <>
          {txnTotal > 0 && (
            <p className="text-xs text-slate-500 mb-3">
              全 {txnTotal} 件中 {txnOffset + 1}〜{Math.min(txnOffset + TXN_PAGE_SIZE, txnTotal)}{" "}
              件を表示
            </p>
          )}

          <InfoNote className="mb-2">{BANK_HELP.list}</InfoNote>
          <TermDetails terms={BANK_TERMS} className="mb-3" />

          {/* 明細テーブル（列が多いので横スクロールさせる。固定幅にしないと右端の列が切れる） */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[72rem]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {[
                      "日付",
                      // すべての口座をまとめて表示しているときは、どの口座の明細かを出す
                      ...(allAccountsView ? ["口座"] : []),
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
                        {h}
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
                        {allAccountsView && (
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                            {accountNameById(t.accountId)}
                          </td>
                        )}
                        <td className="px-4 py-2.5">{t.description}</td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums ${t.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                        >
                          {yen(t.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* 口座間振替は自己資金の移動なので科目に紐付けない（二重計上の防止） */}
                          {t.transferGroupId ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                振替
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
                            <span className="inline-flex items-center gap-1">
                              <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                                チャージ
                              </span>
                              {t.chargeToAccount && (
                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                  → {t.chargeToAccount.name}
                                </span>
                              )}
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
                                {/* 登録をやめる（明細はそのまま残る） */}
                                <button
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `「${registered.label ?? t.description}」の毎月の入出金の登録を解除しますか？`,
                                      )
                                    )
                                      deleteTransfer(registered.id);
                                  }}
                                  className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap"
                                >
                                  解除
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
              <Pager
                offset={currentTxnPage * TXN_PAGE_SIZE}
                pageSize={TXN_PAGE_SIZE}
                total={txnTotal}
                onChange={(o) => setTxnPage(o / TXN_PAGE_SIZE)}
                className="px-4 py-3 border-t border-slate-100"
              />
            )}
          </div>
        </>
      )}

      {/* ── CSV インポートタブ ───────────────────────────────── */}
      {tab === "csv" && (
        <div className="max-w-2xl space-y-6">
          <SectionLead className="-mb-3">{BANK_HELP.csv}</SectionLead>
          {/* すべての口座を表示しているときは、取り込み先の口座をここで選ぶ */}
          {accountId === null && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-600" htmlFor="import-target">
                取り込み先の口座
              </label>
              <select
                id="import-target"
                className="input-field w-60"
                value={importTargetId ?? ""}
                onChange={(e) => setImportTargetId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">選択してください</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}（{a.bankName}）
                  </option>
                ))}
              </select>
            </div>
          )}
          <CsvDropzone busy={importing} onFile={importFile} />

          <div className="card flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">自動取得（同期）</p>
              <p className="text-xs text-slate-400 mt-0.5">口座と連携して最新の明細を取得します</p>
            </div>
            <button onClick={sync} className="btn-secondary whitespace-nowrap">
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
                className="btn-primary"
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
                      className="btn-primary"
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

          {/* ── 取込済み明細の振替紐付け ─────────────── */}
          {recurringParts.includes("match") && (
            <div className="card mb-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
                <h3 className="text-xs font-semibold text-slate-600">取込済み明細の振替紐付け</h3>
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
              <SectionLead>{BANK_HELP.transferMatch}</SectionLead>

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
