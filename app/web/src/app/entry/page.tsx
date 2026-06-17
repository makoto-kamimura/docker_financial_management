"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

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
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
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
    setMessage(res.ok ? "登録しました。" : "登録に失敗しました。");
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h1>実績データ入力</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem", maxWidth: 360 }}>
        <label>
          勘定科目
          <select
            value={form.accountCode}
            onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
            required
          >
            <option value="">選択してください</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.code}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          年度
          <input
            type="number"
            value={form.fiscalYear}
            onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) })}
          />
        </label>
        <label>
          月
          <input
            type="number"
            min={1}
            max={12}
            value={form.month}
            onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
          />
        </label>
        <label>
          金額
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          />
        </label>
        <button type="submit">登録</button>
      </form>
      {message && <p>{message}</p>}
      <p style={{ marginTop: "1rem" }}>
        <a href="/dashboard">← ダッシュボードへ</a>
      </p>
    </main>
  );
}
