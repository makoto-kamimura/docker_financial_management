"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type BankAccount = { id: number; name: string; bankName: string };
type Txn = {
  id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  source: "MANUAL" | "CSV" | "SYNC";
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export default function BankTransactionsPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> => {
      const list = (await (await fetch("/api/bank-accounts")).json()).data as BankAccount[];
      if (list.length && accountId === null) setAccountId(list[0].id);
      return list;
    },
  });

  const { data: txns } = useQuery({
    queryKey: ["bank-txns", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Txn[]> =>
      (await (await fetch(`/api/bank-accounts/${accountId}/transactions`)).json()).data,
  });

  async function importCsv() {
    if (accountId === null || !csv.trim()) return;
    const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });
    const json = await res.json();
    setMsg(res.ok ? `取込: ${json.inserted} 件（エラー ${json.errors?.length ?? 0} 件）` : "取込に失敗しました");
    setCsv("");
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  async function sync() {
    if (accountId === null) return;
    const res = await fetch(`/api/bank-accounts/${accountId}/sync`, { method: "POST" });
    const json = await res.json();
    setMsg(res.ok ? `自動取得（${json.provider}）: ${json.fetched} 件` : "同期に失敗しました");
    qc.invalidateQueries({ queryKey: ["bank-txns", accountId] });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">入出金明細</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          銀行の入出金を自動取得（同期）または CSV で取り込みます
        </p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">口座</label>
            <select
              className="input-field w-56"
              value={accountId ?? ""}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>{a.name}（{a.bankName}）</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-primary px-4 py-2" onClick={sync}>
            自動取得（同期）
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          ※ 自動取得は既定でモックプロバイダです。実銀行接続は口座アグリゲーション事業者の API に差し替えます（docs/deploy・banksync 参照）。
        </p>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            CSV 取込（ヘッダ: date,description,amount[,balance]）
          </label>
          <textarea
            className="input-field font-mono text-xs h-28"
            placeholder={"date,description,amount,balance\n2025-01-25,給与振込,450000,520000"}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <button type="button" className="btn-secondary mt-2 px-4 py-1.5" onClick={importCsv}>
            CSV を取り込む
          </button>
        </div>

        {msg && <p className="text-sm text-slate-600 mt-3">{msg}</p>}
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {["日付", "摘要", "金額", "残高", "取得元"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {txns?.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                  {new Date(t.date).toLocaleDateString("ja-JP")}
                </td>
                <td className="px-4 py-2.5">{t.description}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${t.amount < 0 ? "text-red-600" : "text-green-600"}`}>
                  {yen(t.amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                  {t.balance != null ? yen(t.balance) : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{t.source}</td>
              </tr>
            ))}
            {txns && txns.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-sm">明細がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
