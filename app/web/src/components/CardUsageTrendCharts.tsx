"use client";

// カード・電子マネー管理のサマリ「利用額の推移」（借入金管理の「借入残高の推移」と同じ形）。
// 上に今月の利用額の合計と合計のグラフ、下にカードごとの小さなグラフを並べる。今月より先は破線で、
// 固定決済の合計で見込む（GET /api/linked-accounts/usage-trend。計算は lib/card-usage.ts）。

import { useQuery } from "@tanstack/react-query";
import { SectionLead } from "@/components/Explain";
import { SERIES_COLORS, ValueLineChart } from "@/components/ValueLineChart";
import { asOfDateLabel } from "@/lib/asset-valuation";
import { CARD_HELP } from "@/lib/help-texts";

export type CardUsageTrend = {
  months: string[];
  currentKey: string;
  total: number[];
  cards: { id: number; name: string; values: number[] }[];
};

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : `${Math.round(v).toLocaleString("ja-JP")}円`;

/** 利用額の推移（サマリの一覧でも今月の利用額に使う。キャッシュを共有する） */
export function useCardUsageTrend() {
  return useQuery({
    queryKey: ["card-usage-trend"],
    queryFn: async (): Promise<CardUsageTrend> => {
      const res = await fetch("/api/linked-accounts/usage-trend");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
}

export function CardUsageTrendCharts() {
  const { data } = useCardUsageTrend();
  if (!data || data.cards.length === 0) return null;

  const currentIndex = data.months.indexOf(data.currentKey);
  const nextIndex = currentIndex + 1 < data.months.length ? currentIndex + 1 : null;

  return (
    <section aria-labelledby="card-usage-title" className="card mb-6">
      <h2 id="card-usage-title" className="section-title mb-1">
        利用額の推移
      </h2>
      <SectionLead className="mb-3">{CARD_HELP.usageTrend}</SectionLead>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-1 mb-2">
        <div>
          <p className="text-xs text-slate-500">今月の利用額（{asOfDateLabel(new Date())}）</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">
            {yen(data.total[currentIndex] ?? 0)}
          </p>
        </div>
        {nextIndex !== null && (
          <p className="text-xs text-slate-500">
            来月の固定決済{" "}
            <span className="font-medium text-slate-700">{yen(data.total[nextIndex])}</span>
          </p>
        )}
      </div>
      <ValueLineChart
        months={data.months}
        currentKey={data.currentKey}
        series={[{ key: "total", label: "合計", color: SERIES_COLORS[0], values: data.total }]}
        height={240}
      />

      <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">カードごとの推移</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {data.cards.map((c) => (
          <div key={c.id} className="rounded-lg border border-slate-100 p-3">
            <p className="text-sm font-medium text-slate-800 mb-1">{c.name}</p>
            <p className="text-xs text-slate-500 mb-1">
              今月の利用額{" "}
              <span className="font-medium text-slate-700 tabular-nums">
                {yen(c.values[currentIndex] ?? 0)}
              </span>
            </p>
            <ValueLineChart
              months={data.months}
              currentKey={data.currentKey}
              series={[
                { key: `c${c.id}`, label: "利用額", color: SERIES_COLORS[0], values: c.values },
              ]}
              height={130}
              compact
            />
          </div>
        ))}
      </div>
    </section>
  );
}
