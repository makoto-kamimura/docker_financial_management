"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BalanceChart, type BalancePoint } from "@/components/BalanceChart";

type BankAccount = { id: number; name: string; bankName: string };
type SimResult = {
  accounts: { id: number; name: string }[];
  timeline: BalancePoint[];
  shortfalls: { date: string; accountId: number; accountName: string; balance: number }[];
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export default function SimulationPage() {
  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data,
  });

  const [openings, setOpenings] = useState<Record<number, number>>({});
  const [months, setMonths] = useState(3);

  // 口座取得時に期首残高フォームを初期化
  useEffect(() => {
    if (accounts && Object.keys(openings).length === 0) {
      setOpenings(Object.fromEntries(accounts.map((a) => [a.id, 0])));
    }
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const sim = useMutation({
    mutationFn: async (): Promise<SimResult> => {
      const res = await fetch("/api/transfers/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openings: Object.fromEntries(Object.entries(openings).map(([k, v]) => [k, Number(v)])),
          months,
          startYear: 2025,
          startMonth: 1,
        }),
      });
      return res.json();
    },
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">残高シミュレーション</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          期首残高と登録済みの振込/引き落としから、各口座の残高推移を予測し、残高不足を検出します
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="section-title">条件</h2>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts?.map((a) => (
              <div key={a.id}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {a.name} <span className="text-xs text-slate-400">期首残高</span>
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={openings[a.id] ?? 0}
                  onChange={(e) => setOpenings({ ...openings, [a.id]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">期間</label>
              <select
                className="input-field w-32"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {[3, 6, 12].map((m) => (
                  <option key={m} value={m}>{m}か月</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary px-5 py-2"
              onClick={() => sim.mutate()}
              disabled={sim.isPending}
            >
              {sim.isPending ? "計算中…" : "シミュレーション実行"}
            </button>
          </div>
        </div>
      </div>

      {sim.data && (
        <>
          {sim.data.shortfalls.length > 0 ? (
            <div className="card mb-6 border-red-200 bg-red-50">
              <h2 className="section-title text-red-700">⚠️ 残高不足の警告</h2>
              <ul className="text-sm text-red-700 space-y-1">
                {[...new Map(sim.data.shortfalls.map((s) => [`${s.date}-${s.accountId}`, s])).values()]
                  .slice(0, 10)
                  .map((s, i) => (
                    <li key={i}>
                      {s.date}：<strong>{s.accountName}</strong> が {yen(s.balance)}（マイナス）
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <div className="card mb-6 border-green-200 bg-green-50">
              <p className="text-sm text-green-700">✅ 期間中、残高不足は発生しません。</p>
            </div>
          )}

          <div className="card">
            <h2 className="section-title">残高推移</h2>
            <BalanceChart timeline={sim.data.timeline} accounts={sim.data.accounts} />
          </div>
        </>
      )}
    </AppShell>
  );
}
