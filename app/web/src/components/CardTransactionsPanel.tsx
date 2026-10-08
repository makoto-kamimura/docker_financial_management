"use client";

// カード・電子マネーの明細パネル（明細一覧とカレンダー）。カード・電子マネー管理のタブから、
// 実績管理の「履歴」「カレンダー」（出どころにカード・電子マネーを選んだとき）へ移設した。
// 表示するカードは呼び出し側が選ぶ。科目付け・転記・チャージ先・固定決済・削除と、日付を選んでの
// 利用・返金の登録ができる（API は /api/linked-accounts/{id}/transactions ほか、移設前と同じ）。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { InfoNote, SectionLead, TermDetails } from "@/components/Explain";
import { CARD_HELP, CARD_TERMS } from "@/lib/help-texts";
import { ChargeLinkModal } from "@/components/ChargeLinkModal";
import {
  LINKED_ACCOUNT_TYPE_LABELS,
  isChargeableType,
  type LinkedAccountType,
} from "@/lib/linked-account-type";
import { TXN_SOURCE_LABEL as SOURCE_LABELS } from "@/lib/labels";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";
import { Notice } from "@/components/ui";
import {
  LedgerBadge,
  LedgerFilter,
  LedgerMoreSection,
  LedgerTable,
} from "@/components/LedgerTable";

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
// ── 定数 ────────────────────────────────────────────────────────
const now = new Date();
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// 明細一覧のページング（実績管理の履歴・銀行管理の一覧と同じ 30 件単位）
const TXN_PAGE_SIZE = 30;

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

type PostFilter = "all" | "posted" | "unposted";
const POST_FILTERS: [PostFilter, string][] = [
  ["all", "全件"],
  ["unposted", "実績未転記"],
  ["posted", "実績転記済"],
];

type Props = {
  view: "list" | "calendar";
  /** 表示するカード・電子マネー（呼び出し側のセレクタで選ぶ） */
  accountId: number | null;
};

export function CardTransactionsPanel({ view, accountId }: Props) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  // 明細一覧のページ番号（0 始まり）
  const [txnPage, setTxnPage] = useState(0);
  // ── カレンダー ────────────────────────────────────────────────
  // カレンダーの年は対象年度（左のメニュー）に合わせる。月を送って年をまたいだら、対象年度も変える
  const viewYear = useFiscalYear();
  const setViewYear = (v: number | ((y: number) => number)) =>
    setFiscalYear(typeof v === "function" ? v(viewYear) : v);
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

  // ── ハンドラ ────────────────────────────────────────────────

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
  // 摘要が一致する固定決済があれば「登録済み」として扱う（銀行管理の一覧と同じ判定）
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
      setMsg(
        `毎月${day}日の固定決済として登録しました。カード・電子マネー管理のフロー図にも表示されます。`,
      );
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

  return (
    <>
      {msg && (
        <Notice tone="info" onClose={() => setMsg(null)} className="mb-4">
          {msg}
        </Notice>
      )}

      {view === "list" && (
        <>
          {/* 取込時に自動でチャージ扱いにするルール（card_transfer_rules）。
              一括指定フォームは廃止し、指定は明細一覧の「チャージ先」列で 1 件ずつ行う。
              過去に保存したルールは以後の CSV 取込にも効き続けるため、確認と削除だけ残す。 */}
          {(transferRules ?? []).length > 0 && (
            <div className="card p-4 mb-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">
                取込時に自動でチャージ扱いにするルール
              </h3>
              <SectionLead>
                {CARD_HELP.transferRules}
                個別の指定は、下の一覧の「チャージ先」列から行います。
              </SectionLead>
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

          {/* チャージを「実績未転記」から外している理由も、ここで示す */}
          <InfoNote className="mb-2">
            {CARD_HELP.list}
            {postFilter === "unposted" && <> {CARD_HELP.postFilter}</>}
          </InfoNote>
          <TermDetails terms={CARD_TERMS} className="mb-3" />

          {/* 明細（実績管理の履歴の共通の表: components/LedgerTable.tsx） */}
          <LedgerTable
            total={filteredTxns.length}
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
              // 摘要が一致する固定決済があれば「登録済み」表示に切り替える
              const registered = matchedRecurring(t);
              const excluded = Boolean(t.transferToAccountId || t.chargeGroupId);
              return {
                key: t.id,
                date: new Date(t.date).toLocaleDateString("ja-JP"),
                account: selectedAccount?.name ?? "",
                description: t.description,
                amount: yen(t.amount),
                // カードは利用＝正（支出）、返金＝負
                tone: t.amount > 0 ? "out" : "in",
                category: (
                  <>
                    {/* チャージは資金の移動なので科目に紐付けない（二重計上の防止） */}
                    {t.transferToAccountId ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                          チャージ
                        </span>
                        {t.transferToAccount && (
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            → {t.transferToAccount.name}
                          </span>
                        )}
                      </span>
                    ) : t.chargeGroupId ? (
                      // チャージ元の明細と対にした入金側。こちらも収支には計上しない
                      <span className="inline-flex items-center gap-1">
                        <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                          チャージ入金
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
                  </>
                ),
                status: (
                  <>
                    <LedgerBadge>{SOURCE_LABELS[t.source] ?? t.source}</LedgerBadge>
                    {t.postedRecordId !== null && (
                      <LedgerBadge tone="emerald">転記済み</LedgerBadge>
                    )}
                    {t.transferToAccountId && (
                      <LedgerBadge tone={t.chargeGroupId ? "emerald" : "slate"}>
                        {t.chargeGroupId
                          ? "チャージ（履歴と紐付け済み）"
                          : "チャージ（履歴と未紐付け）"}
                      </LedgerBadge>
                    )}
                    {registered && <LedgerBadge tone="indigo">固定決済</LedgerBadge>}
                  </>
                ),
                actions:
                  !excluded && t.postedRecordId === null ? (
                    <button
                      onClick={() => postTxnToActuals(t.id)}
                      disabled={t.categoryAccountId === null}
                      className="text-xs text-indigo-600 hover:text-indigo-700 disabled:text-slate-300 disabled:cursor-not-allowed"
                    >
                      転記する
                    </button>
                  ) : null,
                more: (
                  <>
                    <LedgerMoreSection title="チャージ先">
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
                    </LedgerMoreSection>
                    <LedgerMoreSection title="固定決済">
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
                    </LedgerMoreSection>
                    <button
                      onClick={() => deleteTxn(t.id)}
                      className="text-xs text-slate-400 hover:text-red-500 text-left"
                    >
                      この明細を削除
                    </button>
                  </>
                ),
              };
            })}
          />
        </>
      )}

      {/* ── カレンダータブ ────────────────────────────────────── */}
      {view === "calendar" && (
        <SectionLead className="-mt-2 mb-4">{CARD_HELP.calendar}</SectionLead>
      )}
      {view === "calendar" && (
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
                      className="btn-primary text-xs mt-1"
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
    </>
  );
}
