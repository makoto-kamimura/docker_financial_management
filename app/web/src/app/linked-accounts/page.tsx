"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type AccountRef = { id: number; code: string; name: string; category: string };
type LinkedAccount = {
  id: number;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  institution: string;
  lastFour: string | null;
  accountId: number | null;
  account: AccountRef | null;
  note: string | null;
};

const TYPE_LABEL = { BANK: "銀行口座", CREDIT_CARD: "クレジットカード" } as const;
const TYPE_BADGE = {
  BANK: "bg-blue-50 text-blue-700",
  CREDIT_CARD: "bg-violet-50 text-violet-700",
} as const;

type FormState = { name: string; type: "BANK" | "CREDIT_CARD"; institution: string; lastFour: string; accountCode: string; note: string };
const BLANK: FormState = { name: "", type: "BANK", institution: "", lastFour: "", accountCode: "", note: "" };

export default function LinkedAccountsPage() {
  const qc = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<LinkedAccount[]> =>
      (await (await fetch("/api/linked-accounts")).json()).data ?? [],
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const [form, setForm] = useState(BLANK);
  const [editItem, setEditItem] = useState<LinkedAccount | null>(null);

  const assetAccounts = accounts?.filter((a) => a.category === "ASSET" || a.category === "LIABILITY") ?? [];

  async function addItem(e: { preventDefault(): void }) {
    e.preventDefault();
    const body: Record<string, string> = { name: form.name, type: form.type, institution: form.institution };
    if (form.lastFour) body.lastFour = form.lastFour;
    if (form.accountCode) body.accountCode = form.accountCode;
    if (form.note) body.note = form.note;
    await fetch("/api/linked-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setForm(BLANK);
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  async function saveEdit() {
    if (!editItem) return;
    await fetch(`/api/linked-accounts/${editItem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editItem.name,
        type: editItem.type,
        institution: editItem.institution,
        lastFour: editItem.lastFour ?? "",
        accountCode: editItem.account?.code ?? "",
        note: editItem.note ?? "",
      }),
    });
    setEditItem(null);
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  async function deleteItem(item: LinkedAccount) {
    if (!confirm(`「${item.name}」を削除してよいですか？`)) return;
    await fetch(`/api/linked-accounts/${item.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  const banks = items?.filter((i) => i.type === "BANK") ?? [];
  const cards = items?.filter((i) => i.type === "CREDIT_CARD") ?? [];

  return (
    <AppShell>
      {/* 編集モーダル */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">口座・カードを編集</h3>
            <div className="space-y-3">
              <input className="input-field w-full" placeholder="名称"
                value={editItem.name} onChange={(e) => setEditItem({ ...editItem, name: e.target.value })} />
              <select className="input-field w-full" value={editItem.type}
                onChange={(e) => setEditItem({ ...editItem, type: e.target.value as "BANK" | "CREDIT_CARD" })}>
                <option value="BANK">銀行口座</option>
                <option value="CREDIT_CARD">クレジットカード</option>
              </select>
              <input className="input-field w-full" placeholder="金融機関名"
                value={editItem.institution} onChange={(e) => setEditItem({ ...editItem, institution: e.target.value })} />
              <input className="input-field w-full" placeholder="下4桁（任意）" maxLength={4}
                value={editItem.lastFour ?? ""} onChange={(e) => setEditItem({ ...editItem, lastFour: e.target.value })} />
              <select className="input-field w-full"
                value={editItem.account?.code ?? ""}
                onChange={(e) => {
                  const acct = assetAccounts.find((a) => a.code === e.target.value) ?? null;
                  setEditItem({ ...editItem, account: acct, accountId: acct?.id ?? null });
                }}>
                <option value="">勘定科目と紐付けない</option>
                {assetAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </select>
              <input className="input-field w-full" placeholder="メモ（任意）"
                value={editItem.note ?? ""} onChange={(e) => setEditItem({ ...editItem, note: e.target.value })} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEdit} className="btn-primary flex-1 py-1.5 text-sm">保存</button>
              <button onClick={() => setEditItem(null)} className="btn-secondary flex-1 py-1.5 text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="page-title">口座・カード管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">銀行口座・クレジットカードと勘定科目の紐付け</p>
      </div>

      {/* 登録フォーム */}
      <div className="card mb-6">
        <h2 className="section-title mb-4">新規登録</h2>
        <form onSubmit={addItem} className="flex gap-2 flex-wrap items-end">
          <div className="flex flex-col gap-1 min-w-28">
            <label className="text-xs text-slate-500">名称</label>
            <input placeholder="例: 住信SBI普通" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required className="input-field" />
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-xs text-slate-500">種別</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "BANK" | "CREDIT_CARD" })}
              className="input-field">
              <option value="BANK">銀行口座</option>
              <option value="CREDIT_CARD">クレジットカード</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-28">
            <label className="text-xs text-slate-500">金融機関</label>
            <input placeholder="例: 住信SBIネット銀行" value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              required className="input-field" />
          </div>
          <div className="flex flex-col gap-1 w-20">
            <label className="text-xs text-slate-500">下4桁</label>
            <input placeholder="1234" maxLength={4} value={form.lastFour}
              onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
              className="input-field" />
          </div>
          <div className="flex flex-col gap-1 min-w-36">
            <label className="text-xs text-slate-500">紐付き勘定科目</label>
            <select value={form.accountCode} onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
              className="input-field">
              <option value="">なし</option>
              {assetAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-24">
            <label className="text-xs text-slate-500">メモ</label>
            <input placeholder="任意" value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="input-field" />
          </div>
          <button type="submit" className="btn-primary px-4">追加</button>
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 銀行口座 */}
        <div className="card">
          <h2 className="section-title">銀行口座 ({banks.length})</h2>
          {banks.length === 0 && <p className="text-xs text-slate-400 mt-2">登録なし</p>}
          <ul className="divide-y divide-slate-100 mt-2">
            {banks.map((item) => (
              <li key={item.id} className="py-3 group flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{item.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_BADGE[item.type]}`}>
                      {TYPE_LABEL[item.type]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {item.institution}{item.lastFour ? ` ****${item.lastFour}` : ""}
                  </p>
                  {item.account && (
                    <p className="text-xs text-indigo-600 mt-0.5">
                      → {item.account.code} {item.account.name}
                    </p>
                  )}
                  {item.note && <p className="text-xs text-slate-400 mt-0.5">{item.note}</p>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => setEditItem(item)} className="text-xs text-slate-400 hover:text-indigo-600">✏️</button>
                  <button onClick={() => deleteItem(item)} className="text-xs text-slate-400 hover:text-red-600">🗑</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* クレジットカード */}
        <div className="card">
          <h2 className="section-title">クレジットカード ({cards.length})</h2>
          {cards.length === 0 && <p className="text-xs text-slate-400 mt-2">登録なし</p>}
          <ul className="divide-y divide-slate-100 mt-2">
            {cards.map((item) => (
              <li key={item.id} className="py-3 group flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{item.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_BADGE[item.type]}`}>
                      {TYPE_LABEL[item.type]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {item.institution}{item.lastFour ? ` ****${item.lastFour}` : ""}
                  </p>
                  {item.account && (
                    <p className="text-xs text-indigo-600 mt-0.5">
                      → {item.account.code} {item.account.name}
                    </p>
                  )}
                  {item.note && <p className="text-xs text-slate-400 mt-0.5">{item.note}</p>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => setEditItem(item)} className="text-xs text-slate-400 hover:text-indigo-600">✏️</button>
                  <button onClick={() => deleteItem(item)} className="text-xs text-slate-400 hover:text-red-600">🗑</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
