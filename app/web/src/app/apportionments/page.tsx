"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type Account = { id: number; code: string; name: string; category: string };
type Apportionment = {
  id: number; accountId: number; businessRate: number | string;
  description: string | null;
  account: Account;
};

function ApportionmentForm({
  accounts, existing, onDone,
}: {
  accounts: Account[];
  existing?: Apportionment;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(existing?.accountId ?? 0);
  const [rate, setRate]           = useState(Number(existing?.businessRate ?? 50));
  const [desc, setDesc]           = useState(existing?.description ?? "");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function submit() {
    setSaving(true); setError(null);
    const res = await fetch("/api/apportionments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, businessRate: rate, description: desc || null }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["apportionments"] });
      onDone();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  const expenseAccounts = accounts.filter(a =>
    ["EXPENSE", "COGS"].includes(a.category)
  );

  return (
    <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">
        {existing ? "按分設定を編集" : "按分設定を追加"}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        <label className="block col-span-1">
          <span className="text-xs font-medium text-slate-600">勘定科目 *</span>
          <select className="input-field mt-1 w-full text-sm" value={accountId}
            onChange={e => setAccountId(Number(e.target.value))}>
            <option value={0}>— 選択 —</option>
            {expenseAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">事業利用率（%） *</span>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={0} max={100} value={rate}
              onChange={e => setRate(Number(e.target.value))}
              className="flex-1" />
            <span className="w-12 text-right text-sm font-bold text-indigo-700">{rate}%</span>
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">メモ</span>
          <input className="input-field mt-1 w-full text-sm" value={desc}
            onChange={e => setDesc(e.target.value)} placeholder="例: 自宅兼事務所" />
        </label>
      </div>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} disabled={saving || !accountId}
          className="btn-primary text-sm px-4 py-1.5">
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={onDone}
          className="text-sm text-slate-500 hover:text-slate-700">キャンセル</button>
      </div>
    </div>
  );
}

export default function AppportionmentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<Apportionment | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["apportionments"],
    queryFn: () => fetch("/api/apportionments").then(r => r.json()).then(r => r.data as Apportionment[]),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts-all"],
    queryFn: () => fetch("/api/accounts").then(r => r.json()).then(r => r.data as Account[]),
  });

  const delMut = useMutation({
    mutationFn: (accountId: number) =>
      fetch(`/api/apportionments?accountId=${accountId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apportionments"] }),
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">家事按分管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">費用科目の事業利用率を設定（F009）</p>
        </div>
        {!showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary text-sm px-4 py-2">
            + 按分設定を追加
          </button>
        )}
      </div>

      {(showForm && !editing) && (
        <ApportionmentForm accounts={accounts} onDone={() => setShowForm(false)} />
      )}

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : list.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          <p className="text-sm">按分設定がありません。</p>
          <p className="text-xs mt-1">自宅兼事務所の家賃・光熱費など、家事按分が必要な費用科目を設定してください。</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left py-2.5 font-medium">勘定科目</th>
                <th className="text-left py-2.5 font-medium">事業利用率</th>
                <th className="text-left py-2.5 font-medium">家事分</th>
                <th className="text-left py-2.5 font-medium">メモ</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map(a => {
                const businessRate = Number(a.businessRate);
                const privateRate  = 100 - businessRate;
                return editing?.id === a.id ? (
                  <tr key={a.id}>
                    <td colSpan={5} className="py-2">
                      <ApportionmentForm
                        accounts={accounts}
                        existing={editing}
                        onDone={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5">
                      <span className="font-medium text-slate-800">{a.account.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{a.account.code}</span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${businessRate}%` }} />
                        </div>
                        <span className="font-bold text-indigo-700">{businessRate}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-500 text-xs">{privateRate}%</td>
                    <td className="py-2.5 text-slate-500 text-xs">{a.description ?? "—"}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2 justify-end">
                        <button type="button" onClick={() => { setEditing(a); setShowForm(false); }}
                          className="text-xs text-indigo-600 hover:underline">編集</button>
                        <button type="button"
                          onClick={() => { if (confirm("削除しますか？")) delMut.mutate(a.accountId); }}
                          className="text-xs text-red-400 hover:text-red-600">削除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
