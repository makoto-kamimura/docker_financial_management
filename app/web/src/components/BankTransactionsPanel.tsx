"use client";

// 銀行の明細の一覧（実績管理の履歴。出どころは銀行）。
// 科目・チャージ先・毎月の入出金（固定入出金）・振替の解除・削除を行ごとに行う。

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChargeLinkModal } from "@/components/ChargeLinkModal";
import { InfoNote, TermDetails } from "@/components/Explain";
import {
  LedgerBadge,
  LedgerFilter,
  LedgerMoreSection,
  LedgerTable,
} from "@/components/LedgerTable";
import { BANK_HELP, BANK_TERMS } from "@/lib/shared/help-texts";
import { isChargeableType, LINKED_ACCOUNT_TYPE_LABELS } from "@/lib/shared/linked-account-type";
import type { LinkedAccountType } from "@/lib/shared/linked-account-type";
import {
  TRANSFER_CHANNEL_LABELS as CHANNEL_LABELS,
  TXN_SOURCE_LABEL as SOURCE_LABELS,
} from "@/lib/shared/labels";
import { Notice } from "@/components/ui";
import { yen } from "@/lib/common/format";

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
  /** 口座間振替で対になる明細の識別子。値があれば科目を付けず、実績に入らない */
  transferGroupId: string | null;
  /** デビット・プリペイド・電子マネーへのチャージの場合のチャージ先。値があれば科目を付けず、実績に入らない */
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

// ── 定数 ────────────────────────────────────────────────────────
// 明細一覧のページング（実績管理の履歴と同じ 30 件単位）
const TXN_PAGE_SIZE = 30;

type PostFilter = "all" | "unassigned" | "actual";
const POST_FILTERS: [PostFilter, string][] = [
  ["all", "全件"],
  ["unassigned", "未割り当て"],
  ["actual", "実績"],
];

type Props = {
  /**
   * 表示対象の口座を親から指定する（銀行管理の「表示する銀行」カード）。null はすべての口座。
   * 渡された場合はパネル内の口座セレクタを出さない。省略時はパネル内で選ぶ（最初の口座を既定にする）。
   */
  accountId?: number | null;
  onAccountIdChange?: (id: number) => void;
};

// ── ページ ──────────────────────────────────────────────────────
export function BankTransactionsPanel({ accountId: accountIdProp, onAccountIdChange }: Props = {}) {
  const qc = useQueryClient();
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

  // 明細一覧は 30 件ずつ表示する。口座切替や再取得で件数が減った場合は末尾ページへ丸める
  // 「全件 / 未割り当て / 実績」（カードの履歴と同じ絞り込み）。
  // 科目を付けた明細がそのまま実績。未割り当ては、これから科目を付ける明細を拾うためのもの
  // （振替・チャージは科目を付けない明細なので除く）
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const filteredTxns = useMemo(() => {
    const all = txns ?? [];
    if (postFilter === "actual") return all.filter((t) => t.categoryAccountId !== null);
    if (postFilter === "unassigned")
      return all.filter(
        (t) =>
          t.categoryAccountId === null &&
          !t.transferGroupId &&
          !t.chargeToAccountId &&
          !t.chargeGroupId,
      );
    return all;
  }, [txns, postFilter]);
  const txnTotal = filteredTxns.length;
  const txnPageCount = Math.max(1, Math.ceil(txnTotal / TXN_PAGE_SIZE));
  const currentTxnPage = Math.min(txnPage, txnPageCount - 1);
  const txnOffset = currentTxnPage * TXN_PAGE_SIZE;
  const pagedTxns = useMemo(
    () => filteredTxns.slice(txnOffset, txnOffset + TXN_PAGE_SIZE),
    [filteredTxns, txnOffset],
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

  async function deleteTxn(t: Txn) {
    const res = await fetch(`/api/bank-accounts/${t.accountId}/transactions?txnId=${t.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg(`削除に失敗しました: ${err.error ?? "エラー"}`);
    }
    invalidateActuals(qc);
    if (t.transferGroupId) {
      // 振替は相手口座の明細も一緒に消えるため、全口座の明細と残高を取り直す
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["cash-outlook"] });
    } else {
      qc.invalidateQueries({ queryKey: ["bank-txns"] });
    }
  }

  // 科目を付けると、その明細がそのまま実績になる。付けた科目は学習し、
  // 同じ摘要でまだ未割り当ての明細にも同じ科目を付ける
  async function setTxnCategory(txnId: number, categoryAccountId: number | null) {
    const res = await fetch(`/api/bank-transactions/${txnId}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId, learn: categoryAccountId !== null }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`科目の変更に失敗しました: ${json.error ?? "エラー"}`);
    } else if ((json.updatedSiblingCount ?? 0) > 0) {
      setMsg(`同じ摘要の未割り当ての明細 ${json.updatedSiblingCount} 件にも同じ科目を付けました。`);
    }
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
    invalidateActuals(qc);
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
          ? "チャージの指定を解除しました。科目を付けられるようになります。"
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
  }

  // 振替の紐付け・解除の後に、残高や収支を参照する画面をまとめて更新する
  function refreshAfterTransferChange() {
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    qc.invalidateQueries({ queryKey: ["cash-outlook"] });
  }

  // 振替の紐付けを解除して独立した 2 明細に戻す（誤って紐付けたときの戻し道）
  async function unlinkTransfer(transferGroupId: string) {
    const confirmed = window.confirm(
      "この振替の紐付けを解除します。\n\n" +
        "明細は両方とも残るため口座残高は変わりませんが、以後それぞれ科目を付けられるようになります（付けた明細が実績になります）。",
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
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(`登録に失敗しました: ${err.error ?? "エラー"}`);
    }
  }

  async function deleteTransfer(id: number) {
    await fetch(`/api/transfers/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["transfers"] });
  }

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
      {accounts && accounts.length === 0 && (
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

      {msg && (
        <Notice tone="info" onClose={() => setMsg(null)} className="mb-4">
          {msg}
        </Notice>
      )}

      {/* ── 明細一覧（実績管理の履歴の共通の表: components/LedgerTable.tsx）──────────── */}
      <InfoNote className="mb-2">{BANK_HELP.list}</InfoNote>
      <TermDetails terms={BANK_TERMS} className="mb-3" />
      <LedgerTable
        total={txnTotal}
        offset={txnOffset}
        pageSize={TXN_PAGE_SIZE}
        onPageChange={(o) => setTxnPage(o / TXN_PAGE_SIZE)}
        toolbar={
          <LedgerFilter
            options={POST_FILTERS}
            value={postFilter}
            onChange={(f) => {
              setPostFilter(f);
              setTxnPage(0);
            }}
          />
        }
        emptyText={
          (txns ?? []).length === 0 ? "明細がありません" : "この条件に一致する明細はありません"
        }
        rows={pagedTxns.map((t) => {
          // 摘要が一致する固定入出金があれば「登録済み」表示に切り替える
          const registered = matchedTransfer(t);
          const excluded = Boolean(t.transferGroupId || t.chargeToAccountId);
          return {
            key: t.id,
            date: new Date(t.date).toLocaleDateString("ja-JP"),
            account: accountNameById(t.accountId),
            description: t.description,
            amount: yen(t.amount),
            tone: t.amount < 0 ? "out" : "in",
            category: (
              <>
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
                    onChange={(e) =>
                      setTxnCategory(t.id, e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white disabled:bg-slate-50 disabled:text-slate-400 min-w-32"
                  >
                    <option value="">未割り当て</option>
                    {categorizableAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ),
            status: (
              <>
                <LedgerBadge>{SOURCE_LABELS[t.source] ?? t.source}</LedgerBadge>
                {!excluded && !t.chargeGroupId && (
                  <LedgerBadge tone={t.categoryAccountId !== null ? "emerald" : "amber"}>
                    {t.categoryAccountId !== null ? "実績" : "未割り当て"}
                  </LedgerBadge>
                )}
                {t.chargeToAccountId && (
                  <LedgerBadge tone={t.chargeGroupId ? "emerald" : "slate"}>
                    {t.chargeGroupId
                      ? "チャージ（履歴と紐付け済み）"
                      : "チャージ（履歴と未紐付け）"}
                  </LedgerBadge>
                )}
                {registered && <LedgerBadge tone="indigo">毎月の入出金</LedgerBadge>}
              </>
            ),
            more: (
              <>
                <LedgerMoreSection title="チャージ先">
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
                  ) : t.transferGroupId ? (
                    // 振替として紐付け済みの明細は先にそちらを外す必要がある
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
                            {LINKED_ACCOUNT_TYPE_LABELS[c.type as LinkedAccountType] ?? c.type}）
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
                </LedgerMoreSection>
                <LedgerMoreSection title="毎月の入出金">
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
                        onChange={(e) => setTxnChannel((m) => ({ ...m, [t.id]: e.target.value }))}
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
                          onChange={(e) => setTxnCard((m) => ({ ...m, [t.id]: e.target.value }))}
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
                </LedgerMoreSection>
                <button
                  onClick={() => deleteTxn(t)}
                  className="text-xs text-slate-400 hover:text-red-500 text-left"
                >
                  この明細を削除
                </button>
              </>
            ),
          };
        })}
      />

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
