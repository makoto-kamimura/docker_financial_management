"use client";

import { useQuery } from "@tanstack/react-query";

type Log = { id: number; userId: number | null; action: string; target: string; changedAt: string };

// 監査ログ閲覧画面（admin 限定。API 側で 403 を返す）。
export default function AuditPage() {
  const { data, error } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async (): Promise<{ data: Log[] }> => {
      const res = await fetch("/api/audit-logs");
      if (!res.ok) throw new Error("forbidden");
      return res.json();
    },
    retry: false,
  });

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 800, margin: "0 auto" }}>
      <h1>監査ログ</h1>
      {error && <p style={{ color: "crimson" }}>閲覧権限がありません（admin のみ）。</p>}
      {data && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={cell}>日時</th>
              <th style={cell}>ユーザー</th>
              <th style={cell}>操作</th>
              <th style={cell}>対象</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((l) => (
              <tr key={l.id}>
                <td style={cell}>{new Date(l.changedAt).toLocaleString("ja-JP")}</td>
                <td style={cell}>{l.userId ?? "—"}</td>
                <td style={cell}>{l.action}</td>
                <td style={cell}>{l.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: "1rem" }}>
        <a href="/dashboard">← ダッシュボードへ</a>
      </p>
    </main>
  );
}

const cell: React.CSSProperties = { border: "1px solid #e5e7eb", padding: "0.4rem", textAlign: "left" };
