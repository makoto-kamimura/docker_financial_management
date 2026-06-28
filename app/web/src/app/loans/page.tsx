"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ── 型 ──────────────────────────────────────────────────────────
type Repayment = { id: number; repaidOn: string; principal: string; interest: string; totalAmount: string };
type Loan = {
  id: number; lenderName: string; amount: string; interestRate: string;
  borrowedOn: string; repaymentDate: string; remainingAmount: string;
  status: string; note: string | null; repayments: Repayment[];
};

// ── グラフ用スケジュール計算 ───────────────────────────────────
const COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

type ChartPoint = { date: string; [key: string]: number | string };

function buildScheduleData(loans: Loan[]): ChartPoint[] {
  if (!loans.length) return [];

  // 全ローンの開始〜終了を含む月次軸を生成
  const allDates = loans.flatMap(l => [new Date(l.borrowedOn), new Date(l.repaymentDate)]);
  const minD = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxD = new Date(Math.max(...allDates.map(d => d.getTime())));
  const cursor = new Date(minD.getFullYear(), minD.getMonth(), 1);
  const endM   = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
  const today  = new Date();

  const points: ChartPoint[] = [];

  while (cursor <= endM) {
    const label = `${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const pt: ChartPoint = { date: label };

    for (const loan of loans) {
      const start     = new Date(loan.borrowedOn);
      const loanEnd   = new Date(loan.repaymentDate);
      const startM    = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMDate  = new Date(loanEnd.getFullYear(), loanEnd.getMonth(), 1);
      const key       = `l${loan.id}`;

      if (cursor < startM) continue; // まだ始まっていない

      if (cursor > endMDate) {
        pt[key] = 0;
        continue;
      }

      // ここまでの実績返済額を累積
      const sorted = [...loan.repayments].sort((a, b) => a.repaidOn.localeCompare(b.repaidOn));
      let balance = Number(loan.amount);
      for (const r of sorted) {
        if (new Date(r.repaidOn) <= cursor) balance -= Number(r.principal);
      }

      // 今日以降は残高から返済期限まで線形に補間（予測）
      if (cursor > today) {
        const remaining   = Number(loan.remainingAmount);
        const msRemaining = endMDate.getTime() - today.getTime();
        const msElapsed   = cursor.getTime() - today.getTime();
        const ratio       = msRemaining > 0 ? Math.max(0, 1 - msElapsed / msRemaining) : 0;
        balance = Math.round(remaining * ratio);
      }

      pt[key] = Math.max(0, Math.round(balance));
    }

    points.push(pt);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return points;
}

const todayLabel = (() => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// ── ページ ──────────────────────────────────────────────────────
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

  const totalBorrowed  = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRemaining = loans.filter(l => l.status === "active").reduce((s, l) => s + Number(l.remainingAmount), 0);
  const scheduleData   = buildScheduleData(loans);
  const activeLoans    = loans.filter(l => l.status === "active");

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">借入金管理</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 text-sm">
          借入追加
        </button>
      </div>

      {/* KPI カード */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">借入残高合計</p>
          <p className="text-2xl font-bold text-red-600">{yen(totalRemaining)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">借入総額</p>
          <p className="text-2xl font-bold text-slate-800">{yen(totalBorrowed)}</p>
        </div>
      </div>

      {/* 返済スケジュールグラフ */}
      {!loading && scheduleData.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">返済スケジュール</h2>
            <span className="text-xs text-slate-400">実線=実績・点線=予測（今日以降）</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={scheduleData} margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis
                tickFormatter={v => `${Math.round(v / 10000)}万`}
                tick={{ fontSize: 10 }}
                width={48}
              />
              <Tooltip
                formatter={(v: number, name: string) => [yen(v), name]}
                labelStyle={{ fontSize: 11 }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {/* 今日の基準線 */}
              <ReferenceLine x={todayLabel} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "今日", fontSize: 10, fill: "#94a3b8" }} />
              {/* ゼロライン */}
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
              {loans.map((loan, i) => (
                <Line
                  key={loan.id}
                  type="monotone"
                  dataKey={`l${loan.id}`}
                  name={loan.lenderName}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* 各ローンの返済期限サマリ */}
          {activeLoans.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {activeLoans.map((l, i) => {
                const progress = 1 - Number(l.remainingAmount) / Number(l.amount);
                return (
                  <div key={l.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span>{l.lenderName}</span>
                    <span className="text-slate-400">返済期限 {l.repaymentDate.slice(0, 7)}</span>
                    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-current rounded-full transition-all" style={{ width: `${Math.round(progress * 100)}%`, color: COLORS[i % COLORS.length] }} />
                    </div>
                    <span className="text-slate-400">{Math.round(progress * 100)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ローン一覧 */}
      {loading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : loans.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🏦</p>
          <p>借入金の記録がありません。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {loans.map((l, i) => (
            <div key={l.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <h2 className="font-semibold text-slate-800">{l.lenderName}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                      {l.status === "active" ? "返済中" : "完済"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm text-slate-600 mt-1 pl-4">
                    <span>借入額: {yen(Number(l.amount))}</span>
                    <span>金利: {(Number(l.interestRate) * 100).toFixed(2)}%</span>
                    <span>残高: <strong className="text-red-600">{yen(Number(l.remainingAmount))}</strong></span>
                    <span>返済期限: {l.repaymentDate.slice(0, 10)}</span>
                  </div>
                  {/* 返済進捗バー */}
                  {Number(l.amount) > 0 && (
                    <div className="mt-2 ml-4 flex items-center gap-2">
                      <div className="w-40 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100)}%`,
                            backgroundColor: COLORS[i % COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        {Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100)}% 返済済
                      </span>
                    </div>
                  )}
                </div>
                {l.status === "active" && (
                  <button
                    onClick={() => setPayForm({ loanId: l.id, principal: "", interest: "0", repaidOn: new Date().toISOString().slice(0, 10) })}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 shrink-0"
                  >
                    返済登録
                  </button>
                )}
              </div>

              {l.repayments.length > 0 && (
                <details className="text-sm">
                  <summary className="text-indigo-600 cursor-pointer hover:underline text-xs">返済履歴 ({l.repayments.length}件)</summary>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        {["返済日", "元金", "利息", "合計"].map(h => <th key={h} className="text-left pb-1 pr-4">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {l.repayments.map(r => (
                        <tr key={r.id}>
                          <td className="pr-4 py-0.5">{r.repaidOn.slice(0, 10)}</td>
                          <td className="pr-4">{yen(Number(r.principal))}</td>
                          <td className="pr-4">{yen(Number(r.interest))}</td>
                          <td>{yen(Number(r.totalAmount))}</td>
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

      {/* 借入追加モーダル */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">借入追加</h2>
            <div className="space-y-3">
              {([ ["lenderName","借入先 *"], ["amount","借入金額（円）*"], ["interestRate","年利率（例: 0.03）"],
                  ["borrowedOn","借入日 *","date"], ["repaymentDate","返済期限 *","date"], ["note","備考"] ] as [keyof typeof newLoan, string, string?][]).map(([k, label, type]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input type={type ?? "text"} value={newLoan[k]}
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

      {/* 返済登録モーダル */}
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
