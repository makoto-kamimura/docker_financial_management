"use client";

// 監査ログ（admin のみ）。ほかの画面と同じく PageHeader と 1 枚のカードの表で見せる。
// 操作したユーザーは今の表示名で出し、ID は小さく添える（GET /api/audit-logs の userName）。

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { Notice, PageHeader } from "@/components/ui";
import { ADMIN_HELP } from "@/lib/help-texts";

type Log = {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  target: string;
  changedAt: string;
};

export default function AuditPage() {
  const { data, error, isLoading } = useQuery({
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
      <PageHeader title="監査ログ" lead={ADMIN_HELP.audit} />

      {error && <Notice tone="error">閲覧権限がありません（admin ロールが必要です）。</Notice>}
      {isLoading && <LoadingSpinner />}

      {data && (
        <section className="card overflow-hidden p-0 mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["日時", "ユーザー", "操作", "対象"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-600"
                    >
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
                    <td className="px-4 py-2.5 text-slate-700">
                      {l.userName ?? "—"}
                      {l.userId !== null && (
                        <span className="ml-1.5 text-[11px] text-slate-400">#{l.userId}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">{l.target}</td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">
                      記録がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}
