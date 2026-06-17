"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type Account = { id: number; code: string; name: string; category: string };
type Department = { id: number; name: string };

const CATEGORIES = [
  { value: "REVENUE", label: "売上" },
  { value: "COGS", label: "売上原価" },
  { value: "EXPENSE", label: "販管費" },
  { value: "PROFIT", label: "利益" },
  { value: "OTHER", label: "その他" },
];

export default function MastersPage() {
  const qc = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => (await (await fetch("/api/accounts")).json()).data,
  });
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> =>
      (await (await fetch("/api/departments")).json()).data,
  });

  const [acct, setAcct] = useState({ code: "", name: "", category: "OTHER" });
  const [deptName, setDeptName] = useState("");

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acct),
    });
    setAcct({ code: "", name: "", category: "OTHER" });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  async function addDepartment(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deptName }),
    });
    setDeptName("");
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 800, margin: "0 auto" }}>
      <h1>マスタ管理</h1>

      <section>
        <h2>勘定科目</h2>
        <form onSubmit={addAccount} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            placeholder="コード"
            value={acct.code}
            onChange={(e) => setAcct({ ...acct, code: e.target.value })}
            required
          />
          <input
            placeholder="名称"
            value={acct.name}
            onChange={(e) => setAcct({ ...acct, name: e.target.value })}
            required
          />
          <select value={acct.category} onChange={(e) => setAcct({ ...acct, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="submit">追加</button>
        </form>
        <ul>
          {accounts?.map((a) => (
            <li key={a.id}>
              {a.code} {a.name}（{CATEGORIES.find((c) => c.value === a.category)?.label}）
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>部門</h2>
        <form onSubmit={addDepartment} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            placeholder="部門名"
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            required
          />
          <button type="submit">追加</button>
        </form>
        <ul>
          {departments?.map((d) => (
            <li key={d.id}>{d.name}</li>
          ))}
        </ul>
      </section>

      <p>
        <a href="/dashboard">← ダッシュボードへ</a>
      </p>
    </main>
  );
}
