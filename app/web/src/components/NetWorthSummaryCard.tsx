"use client";

// 総資産サマリ（F-8: 実物資産・銀行口座残高・ローンを含む純資産）。ダッシュボードの KPI の対象月の時点で出す。
// データは GET /api/assets/summary?year=&month=（時点は月末、今月なら今日。実物資産は評価額の推移の見積もり）。
// 内訳と推移は資産管理で見る。

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SectionLead } from "@/components/Explain";
import { ASSETS_HELP } from "@/lib/help-texts";

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

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

/** 「2026年8月末時点」「2026年10月6日時点」 */
function asOfLabel(s: NetWorthSummary) {
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
    <section aria-labelledby="net-worth-title" className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="net-worth-title" className="section-title">
          総資産サマリ（{asOfLabel(data)}）
        </h2>
        <Link href={"/assets" as never} className="text-xs text-indigo-600 underline">
          資産管理で内訳と推移を見る
        </Link>
      </div>
      <SectionLead className="mb-4">{ASSETS_HELP.netWorth}</SectionLead>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">総資産</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">
            {yen(data.totalAssets)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">総負債</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">
            {yen(data.totalLiabilities)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">純資産</p>
          <p
            className={`text-2xl font-bold tabular-nums ${data.netWorth >= 0 ? "text-indigo-600" : "text-red-600"}`}
          >
            {yen(data.netWorth)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
        {data.breakdown
          .filter((b) => b.amount !== 0)
          .map((b) => (
            <span key={b.key}>
              {b.label}: <span className="font-medium text-slate-700">{yen(b.amount)}</span>
            </span>
          ))}
      </div>
    </section>
  );
}
