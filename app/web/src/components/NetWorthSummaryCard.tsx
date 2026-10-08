"use client";

// 総資産サマリ（F-8: 実物資産・銀行口座残高・ローンを含む純資産）。ダッシュボードの KPI の対象月の時点で出す。
// データは GET /api/assets/summary?year=&month=（時点は月末、今月なら今日。実物資産は評価額の推移の見積もり）。
// 内訳と推移は資産管理で見る。

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SectionCard } from "@/components/SectionCard";
import { ASSETS_HELP } from "@/lib/help-texts";
import { yenShort } from "@/lib/format";

type NetWorthBreakdownItem = { key: string; label: string; amount: number };
type NetWorthSummary = {
  year: number;
  month: number;
  /** 時点（YYYY-MM-DD）。月末、今月なら今日 */
  asOf: string;
  isCurrentMonth: boolean;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdownItem[];
};

/** 「2026年8月末時点」「2026年10月6日時点」（総資産サマリ・総借入サマリで共用） */
export function summaryAsOfLabel(s: { asOf: string; isCurrentMonth: boolean }) {
  const [y, m, d] = s.asOf.split("-").map(Number);
  return s.isCurrentMonth ? `${y}年${m}月${d}日時点` : `${y}年${m}月末時点`;
}

export function NetWorthSummaryCard({ period }: { period: string | null }) {
  const [year, month] = (period ?? "").split("-").map(Number);
  const enabled = Number.isInteger(year) && Number.isInteger(month);
  const { data } = useQuery({
    queryKey: ["assets-summary", year, month],
    queryFn: async (): Promise<NetWorthSummary> =>
      (await fetch(`/api/assets/summary?year=${year}&month=${month}`)).json(),
    enabled,
    placeholderData: (prev) => prev,
  });
  if (!enabled || !data) return null;

  return (
    <SectionCard
      title={<>総資産サマリ（{summaryAsOfLabel(data)}）</>}
      lead={ASSETS_HELP.netWorth}
      actions={
        <Link href={"/assets" as never} className="text-xs text-indigo-600 underline">
          資産管理で内訳と推移を見る
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">総資産</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">
            {yenShort(data.totalAssets)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">総負債</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">
            {yenShort(data.totalLiabilities)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">純資産</p>
          <p
            className={`text-2xl font-bold tabular-nums ${data.netWorth >= 0 ? "text-indigo-600" : "text-red-600"}`}
          >
            {yenShort(data.netWorth)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
        {data.breakdown
          .filter((b) => b.amount !== 0)
          .map((b) => (
            <span key={b.key}>
              {b.label}: <span className="font-medium text-slate-700">{yenShort(b.amount)}</span>
            </span>
          ))}
      </div>
    </SectionCard>
  );
}
