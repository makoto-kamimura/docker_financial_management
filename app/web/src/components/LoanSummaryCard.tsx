"use client";

// 総借入サマリ（ダッシュボード）。総資産サマリと同じく、KPI の対象月の時点（月末、今月なら今日）で出す。
// データは GET /api/loans/summary?year=&month=。残高は借入金管理と同じ計算（lib/loan-balance.ts）。
// 借入の入力・内訳は借入金管理で見る。

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SectionLead } from "@/components/Explain";
import { summaryAsOfLabel } from "@/components/NetWorthSummaryCard";
import { DASHBOARD_HELP } from "@/lib/help-texts";
import { LOAN_TYPE_LABEL } from "@/lib/labels";

type LoanSummary = {
  asOf: string;
  isCurrentMonth: boolean;
  totalBalance: number;
  totalMonthlyPayment: number;
  totalBorrowed: number;
  loans: {
    id: number;
    lenderName: string;
    loanType: string;
    assetName: string | null;
    balance: number;
    monthlyPayment: number;
    /** 年利（小数。0.0131 = 1.31%） */
    interestRate: number;
    repaymentDate: string;
  }[];
};

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

export function LoanSummaryCard({ period }: { period: string | null }) {
  const [year, month] = (period ?? "").split("-").map(Number);
  const enabled = Number.isInteger(year) && Number.isInteger(month);
  const { data } = useQuery({
    queryKey: ["loan-summary", year, month],
    queryFn: async (): Promise<LoanSummary> =>
      (await (await fetch(`/api/loans/summary?year=${year}&month=${month}`)).json()).data,
    enabled,
    placeholderData: (prev) => prev,
  });
  if (!enabled || !data || data.loans.length === 0) return null;

  return (
    <section aria-labelledby="loan-summary-title" className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="loan-summary-title" className="section-title">
          総借入サマリ（{summaryAsOfLabel(data)}）
        </h2>
        <Link href={"/loans" as never} className="text-xs text-indigo-600 underline">
          借入金管理で見る
        </Link>
      </div>
      <SectionLead className="mb-4">{DASHBOARD_HELP.loanSummary}</SectionLead>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">借入残高</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">{yen(data.totalBalance)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">月々の返済額</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">
            {yen(data.totalMonthlyPayment)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">借入総額</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">
            {yen(data.totalBorrowed)}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
        {data.loans.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-2">
            <span className="min-w-40 text-slate-700">
              <span className="mr-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
              </span>
              {l.lenderName}
              {l.assetName && <span className="text-slate-400">（{l.assetName}）</span>}
            </span>
            <span className="text-slate-500">
              残高 <span className="font-medium text-slate-700 tabular-nums">{yen(l.balance)}</span>
            </span>
            <span className="text-slate-500">
              月々 <span className="tabular-nums">{yen(l.monthlyPayment)}</span>
            </span>
            <span className="text-slate-500">金利 {(l.interestRate * 100).toFixed(3)}%</span>
            <span className="text-slate-500">完済予定 {l.repaymentDate.slice(0, 7)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
