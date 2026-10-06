"use client";

// 口座残高サマリ（ダッシュボード）。総資産サマリ・総借入サマリと同じく、KPI の対象月の時点（月末、今月なら今日）で出す。
// データは GET /api/bank-accounts/summary?year=&month=。残高は銀行管理と同じ定義（明細の合計 + 差額）。
// 口座の管理と残高の推移は銀行管理のキャッシュフロータブで見る。

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SectionLead } from "@/components/Explain";
import { summaryAsOfLabel } from "@/components/NetWorthSummaryCard";
import { DASHBOARD_HELP } from "@/lib/help-texts";

type BankSummary = {
  asOf: string;
  isCurrentMonth: boolean;
  totalBalance: number;
  lastUpdatedAt: string | null;
  accounts: { id: number; name: string; bankName: string; balance: number }[];
};

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";
const dateTimeLabel = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function BankSummaryCard({ period }: { period: string | null }) {
  const [year, month] = (period ?? "").split("-").map(Number);
  const enabled = Number.isInteger(year) && Number.isInteger(month);
  const { data } = useQuery({
    queryKey: ["bank-summary", year, month],
    queryFn: async (): Promise<BankSummary> =>
      (await (await fetch(`/api/bank-accounts/summary?year=${year}&month=${month}`)).json()).data,
    enabled,
    placeholderData: (prev) => prev,
  });
  if (!enabled || !data || data.accounts.length === 0) return null;

  return (
    <section aria-labelledby="bank-summary-title" className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="bank-summary-title" className="section-title">
          口座残高サマリ（{summaryAsOfLabel(data)}）
        </h2>
        <Link href={"/bank-accounts" as never} className="text-xs text-indigo-600 underline">
          銀行管理で見る
        </Link>
      </div>
      <SectionLead className="mb-4">{DASHBOARD_HELP.bankSummary}</SectionLead>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">総残高</p>
          <p className="text-2xl font-bold text-indigo-600 tabular-nums">
            {yen(data.totalBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">口座数</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">{data.accounts.length}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">最終更新</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">
            {dateTimeLabel(data.lastUpdatedAt)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
        {data.accounts.map((a) => (
          <span key={a.id}>
            {a.name}（{a.bankName}）:{" "}
            <span className="font-medium text-slate-700 tabular-nums">{yen(a.balance)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
