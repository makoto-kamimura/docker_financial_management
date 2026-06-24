"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Account = { id: number; code: string; name: string; category: string };
type LedgerRow = { date: string; journalId: number; description: string; debit: number; credit: number; balance: number };
type Ledger = { accountId: number; code: string; name: string; rows: LedgerRow[]; totalDebit: number; totalCredit: number };

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledgers, setLedgers]   = useState<Ledger[]>([]);
  const [loading, setLoading]   = useState(false);
  const [year, setYear]         = useState(new Date().getFullYear());
  const [accountId, setAccId]   = useState<number | "">("");
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch("/api/masters/accounts").then(r => r.json()).then(j => setAccounts(j.data ?? []));
  }, []);

  const search = () => {
    setLoading(true);
    const qs = `?year=${year}${accountId ? "&accountId=" + accountId : ""}`;
    fetch(`/api/reports/general-ledger${qs}`).then(r => r.json()).then(j => {
      setLedgers(j.data ?? []);
      setLoading(false);
      setSearched(true);
    });
  };

  const downloadCsv = () => {
    const qs = `?year=${year}${accountId ? "&accountId=" + accountId : ""}&format=csv`;
    window.open(`/api/reports/general-ledger${qs}`, "_blank");
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">総勘定元帳</h1>
        {searched && (
          <button onClick={downloadCsv} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
            CSV ダウンロード
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">年度</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">勘定科目（空白=全科目）</label>
          <select value={accountId} onChange={e => setAccId(e.target.value === "" ? "" : Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64">
            <option value="">— 全科目 —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </div>
        <button onClick={search} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          表示
        </button>
      </div>

      {loading && <p className="text-slate-400">読み込み中…</p>}

      {!loading && searched && ledgers.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📒</p>
          <p>該当する取引が見つかりません。</p>
        </div>
      )}

      {!loading && ledgers.map(l => (
        <div key={l.accountId} className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex justify-between">
            <h2 className="font-semibold text-slate-800">{l.code} {l.name}</h2>
            <div className="text-sm text-slate-500 space-x-4">
              <span>借方合計: <strong className="text-blue-700">¥{l.totalDebit.toLocaleString()}</strong></span>
              <span>貸方合計: <strong className="text-red-700">¥{l.totalCredit.toLocaleString()}</strong></span>
              <span>残高: <strong className={l.totalDebit - l.totalCredit >= 0 ? "text-green-700" : "text-red-700"}>
                ¥{(l.totalDebit - l.totalCredit).toLocaleString()}
              </strong></span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b">
              <tr>
                {["日付","仕訳ID","摘要","借方","貸方","残高"].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {l.rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2">{row.date}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">#{row.journalId}</td>
                  <td className="px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2 text-blue-700">{row.debit > 0 ? `¥${row.debit.toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-2 text-red-700">{row.credit > 0 ? `¥${row.credit.toLocaleString()}` : "—"}</td>
                  <td className={`px-4 py-2 font-medium ${row.balance >= 0 ? "" : "text-red-600"}`}>¥{row.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </AppShell>
  );
}
