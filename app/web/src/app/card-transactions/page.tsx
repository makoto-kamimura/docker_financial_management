"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { AppShell } from "@/components/AppShell";
import { CardUsageTrendCharts, useCardUsageTrend } from "@/components/CardUsageTrendCharts";
import { SectionLead } from "@/components/Explain";
import { CARD_HELP } from "@/lib/help-texts";
import type { FlowGraph } from "@/components/AccountFlowDiagram";
import {
  LINKED_ACCOUNT_TYPES,
  LINKED_ACCOUNT_TYPE_LABELS,
  isChargeableType,
  type LinkedAccountType,
} from "@/lib/linked-account-type";
import { Notice, PageHeader } from "@/components/ui";
import { yen } from "@/lib/format";

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

// ── 定数 ────────────────────────────────────────────────────────

// 電子マネー・プリペイドはカード番号が無く、明細も「チャージ残高からの支払い」なので文言を切り替える
const ACCOUNT_TYPE_LABEL = LINKED_ACCOUNT_TYPE_LABELS;

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

// ── ページ ──────────────────────────────────────────────────────
// bank-transactions/page.tsx（銀行）と同構造。銀行管理のサマリタブに倣い、既定表示の
// 「サマリ」タブでカード・電子マネー関連の資金フロー図を示す。
// クレジット・デビット・プリペイド・電子マネー（Suica・PayPay 等）は明細の構造が同じなので
// 同じ画面で扱う。銀行口座を起点にする引き落としルールの登録は銀行管理側の役割で、
// この画面ではチャージ先の指定と、そのカードでの固定決済の登録だけを行う。
export default function CardTransactionsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  // カード・電子マネー台帳の登録／編集モーダル（設定「口座・カード管理」から移設）
  const [cardForm, setCardForm] = useState<CardForm | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  // ── データ取得 ──────────────────────────────────────────────
  const { data: accounts } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<CardAccount[]> =>
      ((await (await fetch("/api/linked-accounts")).json()).data ?? []) as CardAccount[],
  });

  const { data: categoryAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // サマリタブのフロー図（銀行口座 → カード、カード → チャージ先、カード → 固定決済）
  const { data: cardFlow } = useQuery({
    queryKey: ["card-flow"],
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

  // 今月の利用額（利用額の推移と同じ問い合わせ。null は全カードの合計）
  const { data: usage } = useCardUsageTrend();
  const usageThisMonth = (id: number | null) => {
    if (!usage) return 0;
    const i = usage.months.indexOf(usage.currentKey);
    return id === null
      ? (usage.total[i] ?? 0)
      : (usage.cards.find((c) => c.id === id)?.values[i] ?? 0);
  };

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
    setCardForm(null);
    await qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  async function deleteCard(a: CardAccount) {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/linked-accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      alert(j?.error ?? `削除に失敗しました。(HTTP ${res.status})`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  // 編集中のカードをチャージ先に指定している明細の件数（種別をクレジットへ戻すときの警告用）
  const editingChargeSourceCount =
    cardForm?.id != null
      ? ((accounts ?? []).find((a) => a.id === cardForm.id)?.chargeSourceCount ?? 0)
      : 0;

  return (
    <AppShell>
      {/* ヘッダ（カードの登録はサマリの「カード・電子マネー」の一覧の右上から行う。借入金管理と同じ） */}
      <PageHeader title="カード・電子マネー管理" lead={CARD_HELP.page} />

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

      {/* カード・電子マネーの登録／編集モーダル（設定「口座・カード管理」から移設）*/}
      {cardForm && (
        <Modal size="md">
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
        </Modal>
      )}

      {msg && (
        <Notice tone="info" onClose={() => setMsg(null)} className="mb-4">
          {msg}
        </Notice>
      )}

      {/* ── 借入金管理と同じ並び: 推移 → 一覧 ──────────────────── */}
      <>
        <CardUsageTrendCharts />

        {/* ── カード・電子マネー（借入金管理の「借入金」と同じく 1 枚のカードにまとめる）── */}
        <div className="card mb-6">
          {/* 説明が長くても「カード・電子マネー追加」が右端に残るよう、折り返さない並びにする */}
          <div className="flex items-start gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <h2 className="section-title mb-1">カード・電子マネー</h2>
              <SectionLead className="mb-1">{CARD_HELP.cards}</SectionLead>
              {(accounts ?? []).length > 0 && (
                <p className="text-xs text-slate-400 mt-0.5">
                  今月の利用額の合計: {yen(usageThisMonth(null))} ・ {(accounts ?? []).length} 件
                </p>
              )}
            </div>
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
          </div>
          {!accounts ? (
            <p className="text-slate-400 text-sm">読み込み中…</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-slate-500">
              カード・電子マネーが登録されていません。右上の「カード・電子マネー追加」から登録してください。
            </p>
          ) : (
            <div className="space-y-2">
              {accounts.map((a) => {
                const debits = (cardFlow?.transfers ?? []).filter(
                  (t) => t.linkedAccountId === a.id,
                );
                const recurring = (cardFlow?.recurring ?? []).filter((r) => r.accountId === a.id);
                const recurringTotal = recurring.reduce((sum, r) => sum + r.amount, 0);
                return (
                  <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {ACCOUNT_TYPE_LABEL[a.type] ?? "カード"}
                          </span>
                          <h3 className="font-medium text-slate-800 text-sm">{a.name}</h3>
                          <span className="text-xs text-slate-500">
                            {a.institution}
                            {a.lastFour ? ` ****${a.lastFour}` : ""}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {debits.length > 0 ? (
                            debits.map((t) => (
                              <span key={t.id} className="mr-3">
                                引き落とし: {t.from ?? "口座未設定"} ・ 毎月{t.day}日 ・{" "}
                                {yen(t.amount)}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400">
                              引き落としは未登録（実績管理の履歴で、銀行の引き落としの明細から登録します）
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {recurring.length > 0
                            ? `固定決済: ${recurring.length} 件 ・ 月 ${yen(recurringTotal)}`
                            : "固定決済はありません"}
                        </div>
                        {a.account && (
                          <div className="text-xs text-indigo-600 mt-0.5">
                            紐付く科目: {a.account.code} {a.account.name}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">今月の利用額</p>
                          <p className="font-bold text-rose-600 text-sm tabular-nums">
                            {yen(usageThisMonth(a.id))}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {/* 明細の一覧・登録は実績管理の履歴・カレンダーで行う */}
                          <Link
                            href={`/entry?tab=history&source=card&account=${a.id}` as never}
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                          >
                            明細を見る
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setCardError(null);
                              setCardForm({
                                id: a.id,
                                name: a.name,
                                type: a.type,
                                institution: a.institution,
                                lastFour: a.lastFour ?? "",
                                accountCode: a.account?.code ?? "",
                                note: a.note ?? "",
                              });
                            }}
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCard(a)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>
    </AppShell>
  );
}
