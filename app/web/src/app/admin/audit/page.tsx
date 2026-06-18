"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type Log = { id: number; userId: number | null; action: string; target: string; changedAt: string };

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
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">監査ログ</h1>
        <p className="text-sm text-slate-500 mt-0.5">システム操作の記録（admin 限定）</p>
      </div>

      {error && (
        <div className="card max-w-md text-sm text-red-600 bg-red-50 border-red-200 py-4">
          閲覧権限がありません（admin ロールが必要です）。
        </div>
      )}

      {data && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["日時", "ユーザー ID", "操作", "対象"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(l.changedAt).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{l.userId ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                      {l.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">{l.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
