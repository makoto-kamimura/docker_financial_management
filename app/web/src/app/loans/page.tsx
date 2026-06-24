"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Repayment = { id: number; repaidOn: string; principal: string; interest: string; totalAmount: string };
type Loan = {
  id: number; lenderName: string; amount: string; interestRate: string;
  borrowedOn: string; repaymentDate: string; remainingAmount: string;
  status: string; note: string | null; repayments: Repayment[];
};

export default function LoansPage() {
  const [loans, setLoans]       = useState<Loan[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [payForm, setPayForm]   = useState<{ loanId: number | null; principal: string; interest: string; repaidOn: string }>({
    loanId: null, principal: "", interest: "0", repaidOn: new Date().toISOString().slice(0, 10),
  });
  const [newLoan, setNewLoan] = useState({
    lenderName: "", amount: "", interestRate: "0", borrowedOn: "", repaymentDate: "", note: "",
  });

  const load = () => {
    setLoading(true);
    fetch("/api/loans").then(r => r.json()).then(j => { setLoans(j.data ?? []); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const saveLoan = async () => {
    const r = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newLoan, amount: Number(newLoan.amount), interestRate: Number(newLoan.interestRate) }),
    });
    if (r.ok) { setShowForm(false); load(); }
  };

  const repay = async () => {
    if (!payForm.loanId) return;
    const r = await fetch(`/api/loans/${payForm.loanId}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repaidOn: payForm.repaidOn, principal: Number(payForm.principal), interest: Number(payForm.interest) }),
    });
    if (r.ok) { setPayForm(f => ({ ...f, loanId: null })); load(); }
  };

  const totalBorrowed   = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRemaining  = loans.filter(l => l.status === "active").reduce((s, l) => s + Number(l.remainingAmount), 0);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">借入金管理</h1>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          借入追加
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">借入残高合計</p>
          <p className="text-2xl font-bold text-red-600">¥{totalRemaining.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">借入総額</p>
          <p className="text-2xl font-bold text-slate-800">¥{totalBorrowed.toLocaleString()}</p>
        </div>
      </div>

      {loading ? <p className="text-slate-400">読み込み中…</p> : loans.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🏦</p>
          <p>借入金の記録がありません。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {loans.map(l => (
            <div key={l.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-800">{l.lenderName}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                      {l.status === "active" ? "返済中" : "完済"}
                    </span>
                  </div>
                  <div className="flex gap-6 text-sm text-slate-600 mt-1">
                    <span>借入額: ¥{Number(l.amount).toLocaleString()}</span>
                    <span>金利: {(Number(l.interestRate) * 100).toFixed(2)}%</span>
                    <span>残高: <strong className="text-red-600">¥{Number(l.remainingAmount).toLocaleString()}</strong></span>
                    <span>返済期限: {l.repaymentDate.slice(0, 10)}</span>
                  </div>
                </div>
                {l.status === "active" && (
                  <button onClick={() => setPayForm({ loanId: l.id, principal: "", interest: "0", repaidOn: new Date().toISOString().slice(0, 10) })}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
                    返済登録
                  </button>
                )}
              </div>
              {l.repayments.length > 0 && (
                <details className="text-sm">
                  <summary className="text-indigo-600 cursor-pointer hover:underline">返済履歴 ({l.repayments.length}件)</summary>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        {["返済日","元金","利息","合計"].map(h => <th key={h} className="text-left pb-1 pr-4">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {l.repayments.map(r => (
                        <tr key={r.id}>
                          <td className="pr-4 py-0.5">{r.repaidOn.slice(0, 10)}</td>
                          <td className="pr-4">¥{Number(r.principal).toLocaleString()}</td>
                          <td className="pr-4">¥{Number(r.interest).toLocaleString()}</td>
                          <td>¥{Number(r.totalAmount).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">借入追加</h2>
            <div className="space-y-3">
              {[["lenderName","借入先 *"],["amount","借入金額（円）*"],["interestRate","年利率（例: 0.03）"],["borrowedOn","借入日 *","date"],["repaymentDate","返済期限 *","date"],["note","備考"]].map(([k, label, type]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input type={type ?? "text"} value={newLoan[k as keyof typeof newLoan]}
                    onChange={e => setNewLoan(f => ({ ...f, [k]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={saveLoan} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {payForm.loanId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4">返済登録</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">返済日 *</label>
                <input type="date" value={payForm.repaidOn} onChange={e => setPayForm(f => ({ ...f, repaidOn: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">元金（円）*</label>
                <input type="number" value={payForm.principal} onChange={e => setPayForm(f => ({ ...f, principal: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">利息（円）</label>
                <input type="number" value={payForm.interest} onChange={e => setPayForm(f => ({ ...f, interest: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPayForm(f => ({ ...f, loanId: null }))} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={repay} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">登録</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
