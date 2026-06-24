"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type BankAccount = {
  id: number; name: string; bankName: string; branchName: string | null;
  accountType: string; accountNumber: string | null; balance: string;
  _count: { transactions: number };
};
type Tx = {
  id: number; transactionDate: string; description: string;
  amount: string; balanceAfter: string; category: string | null; reconciled: boolean;
};

const TYPE_LABEL: Record<string, string> = { ORDINARY: "普通預金", CURRENT: "当座預金", FIXED: "定期預金" };

export default function BankAccountsPage() {
  const [accounts, setAccounts]   = useState<BankAccount[]>([]);
  const [selected, setSelected]   = useState<BankAccount | null>(null);
  const [txs, setTxs]             = useState<Tx[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [showAccForm, setShowAccForm] = useState(false);
  const [showTxForm, setShowTxForm]   = useState(false);
  const [accForm, setAccForm] = useState({ name: "", bankName: "", branchName: "", accountType: "ORDINARY", accountNumber: "", balance: "0" });
  const [txForm, setTxForm]  = useState({ transactionDate: new Date().toISOString().slice(0, 10), description: "", amount: "", category: "" });

  const loadAccounts = () => {
    setLoading(true);
    fetch("/api/bank-accounts").then(r => r.json()).then(j => { setAccounts(j.data ?? []); setLoading(false); });
  };

  const loadTx = (id: number) => {
    setLoadingTx(true);
    fetch(`/api/bank-accounts/${id}/transactions`).then(r => r.json()).then(j => { setTxs(j.data ?? []); setLoadingTx(false); });
  };

  useEffect(() => { loadAccounts(); }, []);

  const selectAcc = (a: BankAccount) => {
    setSelected(a);
    loadTx(a.id);
  };

  const saveAccount = async () => {
    const r = await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...accForm, balance: Number(accForm.balance) }),
    });
    if (r.ok) { setShowAccForm(false); loadAccounts(); }
  };

  const saveTx = async () => {
    if (!selected) return;
    const r = await fetch(`/api/bank-accounts/${selected.id}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...txForm, amount: Number(txForm.amount) }),
    });
    if (r.ok) {
      setShowTxForm(false);
      const updated = await fetch("/api/bank-accounts").then(r => r.json());
      setAccounts(updated.data ?? []);
      const sel = updated.data?.find((a: BankAccount) => a.id === selected.id);
      if (sel) setSelected(sel);
      loadTx(selected.id);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">銀行・資金管理</h1>
        <button onClick={() => setShowAccForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          口座追加
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {loading ? <p className="col-span-3 text-slate-400">読み込み中…</p> : accounts.map(a => (
          <button key={a.id} onClick={() => selectAcc(a)}
            className={`p-4 rounded-xl border text-left transition-all ${selected?.id === a.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`}>
            <div className="text-xs text-slate-500 mb-1">{a.bankName}{a.branchName ? " " + a.branchName : ""} / {TYPE_LABEL[a.accountType] ?? a.accountType}</div>
            <div className="font-semibold text-slate-800">{a.name}</div>
            <div className="text-lg font-bold text-indigo-600 mt-1">¥{Number(a.balance).toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">{a._count.transactions}件の取引</div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">{selected.name} — 取引履歴</h2>
            <button onClick={() => setShowTxForm(true)} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              入出金追加
            </button>
          </div>
          {loadingTx ? <p className="px-5 py-4 text-slate-400">読み込み中…</p> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {["日付","摘要","入出金","残高","カテゴリ"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {txs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">取引なし</td></tr>
                ) : txs.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">{tx.transactionDate.slice(0, 10)}</td>
                    <td className="px-4 py-2.5">{tx.description}</td>
                    <td className={`px-4 py-2.5 font-medium ${Number(tx.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {Number(tx.amount) >= 0 ? "+" : ""}¥{Number(tx.amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">¥{Number(tx.balanceAfter).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-500">{tx.category ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showAccForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">口座追加</h2>
            <div className="space-y-3">
              {[["name","口座名 *"],["bankName","銀行名 *"],["branchName","支店名"],["accountNumber","口座番号"]].map(([k, label]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input value={accForm[k as keyof typeof accForm]} onChange={e => setAccForm(f => ({ ...f, [k]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">種別</label>
                <select value={accForm.accountType} onChange={e => setAccForm(f => ({ ...f, accountType: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="ORDINARY">普通預金</option>
                  <option value="CURRENT">当座預金</option>
                  <option value="FIXED">定期預金</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">初期残高（円）</label>
                <input type="number" value={accForm.balance} onChange={e => setAccForm(f => ({ ...f, balance: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAccForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={saveAccount} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {showTxForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">入出金追加（{selected?.name}）</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">日付 *</label>
                <input type="date" value={txForm.transactionDate} onChange={e => setTxForm(f => ({ ...f, transactionDate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">摘要 *</label>
                <input value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">金額（入金=正、出金=負）*</label>
                <input type="number" value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="例: 100000 または -50000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">カテゴリ</label>
                <select value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">—</option>
                  <option value="income">収入</option>
                  <option value="expense">支出</option>
                  <option value="transfer">振替</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowTxForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={saveTx} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
