"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { AppShell } from "@/components/AppShell";
import { SectionLead } from "@/components/Explain";
import { Notice, PageHeader } from "@/components/ui";
import { BusinessUseToggle } from "@/components/BusinessUseToggle";
import { SHOP_HELP } from "@/lib/shared/help-texts";
import {
  SHOP_ACCOUNT_TYPES,
  SHOP_ACCOUNT_TYPE_LABELS,
  SHOP_PRESETS,
  parseKeywordList,
  shopKeywords,
  shopOrderHistoryUrl,
  type ShopAccountType,
} from "@/lib/shared/shop-account-type";
import { useActualsScope } from "@/lib/client/use-view-mode";
import { withScope } from "@/lib/shared/business-use";

// 明細管理。Amazon・ヨドバシ・楽天などの通販を「明細分け」として登録する（カード・電子マネー管理と同じ作り）。
// 注文の CSV の取り込みと商品の科目付けは、実績管理の「取り込み」「履歴」（出どころ: 明細分け）で行う。

type ShopAccount = {
  id: number;
  name: string;
  type: ShopAccountType;
  matchKeywords: string[];
  excludeKeywords: string[];
  paymentCardIds: number[];
  paymentBankIds: number[];
  statementUrl: string | null;
  businessUse: boolean;
  note: string | null;
  chargeCount: number;
  unlinkedCount: number;
  uncategorizedCount: number;
  lastImportedAt: string | null;
};

type PaymentSource = { id: number; name: string };

type ShopForm = {
  /** 新規登録は null、編集は対象 id */
  id: number | null;
  name: string;
  type: ShopAccountType;
  /** 読点・カンマ区切りで入力する */
  matchKeywords: string;
  excludeKeywords: string;
  paymentCardIds: number[];
  paymentBankIds: number[];
  statementUrl: string;
  businessUse: boolean;
  note: string;
};

const BLANK_FORM: ShopForm = {
  id: null,
  name: "",
  type: "AMAZON",
  matchKeywords: "",
  excludeKeywords: "",
  paymentCardIds: [],
  paymentBankIds: [],
  statementUrl: "",
  businessUse: false,
  note: "",
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

export default function ShopAccountsPage() {
  const qc = useQueryClient();
  const scope = useActualsScope();
  const [form, setForm] = useState<ShopForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: shops } = useQuery({
    queryKey: ["shop-accounts", scope],
    enabled: scope !== null,
    queryFn: async (): Promise<ShopAccount[]> =>
      (await (await fetch(withScope("/api/shop-accounts", scope!))).json()).data ?? [],
  });
  const { data: cards } = useQuery({
    queryKey: ["linked-accounts", scope],
    enabled: scope !== null,
    queryFn: async (): Promise<PaymentSource[]> =>
      (await (await fetch(withScope("/api/linked-accounts", scope!))).json()).data ?? [],
  });
  const { data: banks } = useQuery({
    queryKey: ["bank-accounts", scope],
    enabled: scope !== null,
    queryFn: async (): Promise<PaymentSource[]> =>
      (await (await fetch(withScope("/api/bank-accounts", scope!))).json()).data ?? [],
  });
  const cardName = new Map((cards ?? []).map((c) => [c.id, c.name]));
  const bankName = new Map((banks ?? []).map((b) => [b.id, b.name]));

  function openNew() {
    setFormError(null);
    // 個人事業主モードで足す明細分けは、事業利用で始める
    setForm({ ...BLANK_FORM, name: "Amazon", businessUse: scope === "business" });
  }

  function openEdit(a: ShopAccount) {
    setFormError(null);
    setForm({
      id: a.id,
      name: a.name,
      type: a.type,
      matchKeywords: a.matchKeywords.join("、"),
      excludeKeywords: a.excludeKeywords.join("、"),
      paymentCardIds: a.paymentCardIds,
      paymentBankIds: a.paymentBankIds,
      statementUrl: a.statementUrl ?? "",
      businessUse: a.businessUse,
      note: a.note ?? "",
    });
  }

  async function save() {
    if (!form) return;
    setFormError(null);
    const body = {
      name: form.name,
      type: form.type,
      matchKeywords: parseKeywordList(form.matchKeywords),
      excludeKeywords: parseKeywordList(form.excludeKeywords),
      paymentCardIds: form.paymentCardIds,
      paymentBankIds: form.paymentBankIds,
      businessUse: form.businessUse,
      // 空文字は「既定に戻す・消す」意味なので、編集のときはそのまま送る
      ...(form.statementUrl || form.id !== null ? { statementUrl: form.statementUrl } : {}),
      ...(form.note || form.id !== null ? { note: form.note } : {}),
    };
    const res = await fetch(
      form.id === null ? "/api/shop-accounts" : `/api/shop-accounts/${form.id}`,
      {
        method: form.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setFormError(j?.error ?? "保存に失敗しました");
      return;
    }
    setForm(null);
    await qc.invalidateQueries({ queryKey: ["shop-accounts"] });
  }

  async function remove(a: ShopAccount) {
    if (!confirm(`「${a.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/shop-accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      alert(j?.error ?? `削除に失敗しました。(HTTP ${res.status})`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["shop-accounts"] });
  }

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <AppShell>
      <PageHeader title="明細管理" lead={SHOP_HELP.page} />

      {shops && shops.length === 0 && (
        <Notice tone="warn" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <span>
              明細分けが登録されていません。Amazon などの注文を取り込むには、先に登録してください。
            </span>
            <button
              type="button"
              onClick={openNew}
              className="shrink-0 text-amber-900 font-medium underline underline-offset-2 hover:text-amber-700"
            >
              明細分けを登録する
            </button>
          </div>
        </Notice>
      )}

      {form && (
        <Modal size="md">
          <h2 className="text-lg font-bold text-slate-800 mb-1">
            {form.id === null ? "明細分けを追加" : "明細分けを編集"}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            通販の注文の CSV
            を取り込む先です。取り込んだ注文は、カード・銀行の明細に紐付けて、商品ごとに科目を付けます。
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">種類</label>
              <div className="flex flex-wrap rounded-lg overflow-hidden border border-slate-200 text-sm">
                {SHOP_ACCOUNT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        type: t,
                        // 名前を既定のまま使っていれば、種類に合わせて替える
                        name:
                          form.name === "" ||
                          SHOP_ACCOUNT_TYPES.some((x) => SHOP_ACCOUNT_TYPE_LABELS[x] === form.name)
                            ? t === "OTHER"
                              ? ""
                              : SHOP_ACCOUNT_TYPE_LABELS[t]
                            : form.name,
                      })
                    }
                    className={`px-3 py-2 font-medium transition-colors ${
                      form.type === t
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {SHOP_ACCOUNT_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">名称 *</label>
              <input
                placeholder="例: Amazon"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                紐付ける明細の摘要
              </label>
              <input
                placeholder={SHOP_PRESETS[form.type].match.join("、") || "例: SHOPNAME、ショップ"}
                value={form.matchKeywords}
                onChange={(e) => setForm({ ...form, matchKeywords: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <label className="block text-xs font-medium text-slate-500 mt-2 mb-1">
                除外する摘要
              </label>
              <input
                placeholder={SHOP_PRESETS[form.type].exclude.join("、") || "なし"}
                value={form.excludeKeywords}
                onChange={(e) => setForm({ ...form, excludeKeywords: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                {SHOP_HELP.keywords}（読点・カンマで区切ります）
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                支払いに使うカード・口座
              </label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {(cards ?? []).map((c) => (
                  <label
                    key={`c${c.id}`}
                    className="flex items-center gap-1.5 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={form.paymentCardIds.includes(c.id)}
                      onChange={() =>
                        setForm({ ...form, paymentCardIds: toggleId(form.paymentCardIds, c.id) })
                      }
                    />
                    {c.name}
                  </label>
                ))}
                {(banks ?? []).map((b) => (
                  <label
                    key={`b${b.id}`}
                    className="flex items-center gap-1.5 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={form.paymentBankIds.includes(b.id)}
                      onChange={() =>
                        setForm({ ...form, paymentBankIds: toggleId(form.paymentBankIds, b.id) })
                      }
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">{SHOP_HELP.payment}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                注文履歴のページの URL
              </label>
              <input
                type="url"
                inputMode="url"
                placeholder={SHOP_PRESETS[form.type].url ?? "https://"}
                value={form.statementUrl}
                onChange={(e) => setForm({ ...form, statementUrl: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                空欄なら種類の既定のページを開きます（実績管理の取り込みから）。
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">メモ</label>
              <input
                placeholder="任意"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <BusinessUseToggle
              kind="shop"
              checked={form.businessUse}
              onChange={(v) => setForm({ ...form, businessUse: v })}
            />
            {formError && <p className="text-xs text-red-600">{formError}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setForm(null)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              キャンセル
            </button>
            <button
              onClick={save}
              disabled={!form.name.trim()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"
            >
              {form.id === null ? "登録" : "保存"}
            </button>
          </div>
        </Modal>
      )}

      <div className="card mb-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h2 className="section-title mb-1">明細分け</h2>
            <SectionLead className="mb-1">{SHOP_HELP.list}</SectionLead>
          </div>
          <button type="button" onClick={openNew} className="btn-primary shrink-0">
            明細分けを追加
          </button>
        </div>
        {!shops ? (
          <p className="text-slate-400 text-sm">読み込み中…</p>
        ) : shops.length === 0 ? (
          <p className="text-sm text-slate-500">
            明細分けが登録されていません。右上の「明細分けを追加」から登録してください。
          </p>
        ) : (
          <div className="space-y-2">
            {shops.map((a) => {
              const kw = shopKeywords(a);
              const payments = [
                ...a.paymentCardIds.map((id) => cardName.get(id)),
                ...a.paymentBankIds.map((id) => bankName.get(id)),
              ].filter(Boolean);
              const url = shopOrderHistoryUrl(a);
              return (
                <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {SHOP_ACCOUNT_TYPE_LABELS[a.type] ?? "その他"}
                        </span>
                        <h3 className="font-medium text-slate-800 text-sm">
                          {a.name}
                          {a.businessUse && (
                            <span className="ml-1.5 badge badge-blue align-middle">事業</span>
                          )}
                        </h3>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-500 hover:text-indigo-700"
                          >
                            注文履歴を開く
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        摘要:{" "}
                        {kw.match.length > 0
                          ? kw.match.join("、")
                          : "未設定（紐付けは手で行います）"}
                        {kw.exclude.length > 0 && ` ・ 除外: ${kw.exclude.join("、")}`}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        支払い: {payments.length > 0 ? payments.join("、") : "すべてのカード・口座"}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {a.chargeCount > 0
                          ? `請求 ${a.chargeCount} 件 ・ 未紐付け ${a.unlinkedCount} 件 ・ 科目なしの商品 ${a.uncategorizedCount} 件`
                          : "まだ注文を取り込んでいません"}
                        {a.lastImportedAt && ` ・ 最後の取り込み ${fmtDate(a.lastImportedAt)}`}
                      </div>
                      {a.note && <div className="text-xs text-slate-400 mt-0.5">{a.note}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {/* 注文の一覧と商品の科目付けは、実績管理の履歴（出どころ: 明細分け）で行う */}
                      <Link
                        href={`/entry?tab=history&source=shop&account=${a.id}` as never}
                        className="text-xs text-indigo-500 hover:text-indigo-700"
                      >
                        注文を見る
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEdit(a)}
                        className="text-xs text-indigo-500 hover:text-indigo-700"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
