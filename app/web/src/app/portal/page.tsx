"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

type TenantSummary = {
  tenantId: number;
  tenantName: string;
  fiscalYear: number;
  revenue: number;
  expense: number;
  netIncome: number;
  closeStatus: string;
  pendingApprovals: number;
};

type PortalResponse = {
  fiscalYear: number;
  tenants: TenantSummary[];
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "未締め", cls: "bg-amber-100 text-amber-700" },
  CLOSED: { label: "締め済み", cls: "bg-green-100 text-green-700" },
};

export default function PortalPage() {
  const now = new Date();
  const [fiscalYear, setFiscalYear] = useState(now.getFullYear());

  const { data, isLoading, error } = useQuery<PortalResponse>({
    queryKey: ["portal", fiscalYear],
    queryFn: async () => {
      const res = await fetch(`/api/portal?fiscalYear=${fiscalYear}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("権限がありません");
        throw new Error("データの取得に失敗しました");
      }
      return res.json();
    },
  });

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  const totalRevenue = data?.tenants.reduce((s, t) => s + t.revenue, 0) ?? 0;
  const totalExpense = data?.tenants.reduce((s, t) => s + t.expense, 0) ?? 0;
  const totalNet = data?.tenants.reduce((s, t) => s + t.netIncome, 0) ?? 0;
  const totalPending = data?.tenants.reduce((s, t) => s + t.pendingApprovals, 0) ?? 0;

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">税理士ポータル</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            複数テナント横断 財務サマリ（accountant 以上）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="portal-year" className="text-sm text-slate-600">
            会計年度
          </label>
          <select
            id="portal-year"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="input-field w-28 py-1.5 text-sm"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* サマリカード */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "総収益", value: yen(totalRevenue), sub: `${data.tenants.length} テナント` },
            { label: "総費用", value: yen(totalExpense), sub: "経費＋原価" },
            { label: "総純利益", value: yen(totalNet), sub: totalNet >= 0 ? "黒字" : "赤字" },
            { label: "未承認仕訳", value: String(totalPending), sub: "件の承認待ち" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card p-4">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className="text-lg font-bold text-slate-800">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div
          className="flex items-center justify-center h-40 text-sm text-slate-400"
          aria-live="polite"
        >
          読み込み中…
        </div>
      )}

      {error && (
        <p
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3"
          role="alert"
        >
          {error.message}
        </p>
      )}

      {data && data.tenants.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-12">テナントが登録されていません。</p>
      )}

      {/* テナント一覧テーブル */}
      {data && data.tenants.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm" role="table" aria-label="テナント財務サマリ">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">テナント名</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">収益</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">費用</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">純利益</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">決算状況</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">未承認仕訳</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.tenants.map((t) => {
                const status = STATUS_LABEL[t.closeStatus] ?? {
                  label: t.closeStatus,
                  cls: "bg-slate-100 text-slate-600",
                };
                return (
                  <tr key={t.tenantId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{t.tenantName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{yen(t.revenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{yen(t.expense)}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${t.netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}
                    >
                      {yen(t.netIncome)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.pendingApprovals > 0 ? (
                        <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          {t.pendingApprovals} 件
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
