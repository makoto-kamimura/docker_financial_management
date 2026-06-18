"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type Account = { id: number; code: string; name: string };

export default function EntryPage() {
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      return json.data;
    },
  });

  const [form, setForm] = useState({ accountCode: "", fiscalYear: 2025, month: 1, amount: 0 });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/financials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountCode: form.accountCode,
        fiscalYear: Number(form.fiscalYear),
        month: Number(form.month),
        amount: Number(form.amount),
      }),
    });
    setMessage(res.ok ? { ok: true, text: "登録しました。" } : { ok: false, text: "登録に失敗しました。" });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">実績データ入力</h1>
        <p className="text-sm text-slate-500 mt-0.5">月次の財務実績を登録します</p>
      </div>

      <div className="card max-w-md">
        <h2 className="section-title">新規登録</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">勘定科目</label>
            <select
              value={form.accountCode}
              onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
              required
              className="input-field"
            >
              <option value="">選択してください</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">年度</label>
              <input
                type="number"
                value={form.fiscalYear}
                onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">月</label>
              <input
                type="number"
                min={1}
                max={12}
                value={form.month}
                onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">金額</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="input-field"
            />
          </div>

          {message && (
            <p
              className={`text-sm rounded-lg px-3 py-2 border ${
                message.ok
                  ? "text-green-700 bg-green-50 border-green-200"
                  : "text-red-600 bg-red-50 border-red-200"
              }`}
            >
              {message.text}
            </p>
          )}

          <button type="submit" className="btn-primary w-full py-2.5">
            登録
          </button>
        </form>
      </div>
    </AppShell>
  );
}
