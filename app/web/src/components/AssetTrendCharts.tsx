"use client";

// 実物資産の評価額の推移（資産管理）。上に「資産計上」の合計、下に資産ごとの小さなグラフを並べる。
// データは GET /api/personal-assets/trend（月末ごと）。今月より先は見積もりなので破線で描く。
// 評価額を手で入れた点を通り、最後の点から先は価値の変わり方で見積もる（lib/asset-valuation.ts）。
// 内訳のある資産（土地と建物など）は、内訳ごとの線を重ねる（色は内訳の順に固定。4 つ目からは「その他」）。

import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { LoadingSpinner } from "@/components/StateViews";
import {
  OTHER_COLOR,
  SERIES_COLORS,
  ValueLineChart,
  type ChartSeries,
} from "@/components/ValueLineChart";
import { ASSETS_HELP } from "@/lib/help-texts";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "@/lib/labels";
import { asOfDateLabel, TREND_LABEL, type ValueTrend } from "@/lib/asset-valuation";
import { yenShort } from "@/lib/format";

type TrendSeries = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  series: (number | null)[];
};
type TrendAsset = TrendSeries & {
  countAsAsset: boolean;
  estimatedValue: number | null;
  parts: TrendSeries[];
};
type TrendResponse = {
  months: string[];
  currentKey: string;
  total: (number | null)[];
  assets: TrendAsset[];
};

/** 1 年後の見積もりと今を比べた向き（グラフの右肩の印） */
function trendOfSeries(
  months: string[],
  currentKey: string,
  values: (number | null)[],
): ValueTrend {
  const i = months.indexOf(currentKey);
  const now = values[i];
  const later = values[Math.min(i + 12, values.length - 1)];
  if (i < 0 || now === null || later === null || Math.abs(later - now) < 1) return "flat";
  return later > now ? "up" : "down";
}

export function TrendBadge({ trend }: { trend: ValueTrend }) {
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
      <Icon className="w-3 h-3" aria-hidden="true" />
      {TREND_LABEL[trend]}
    </span>
  );
}

/** 内訳を系列に直す（4 つ目からは「その他」にまとめる） */
function partSeries(parts: TrendSeries[]): ChartSeries[] {
  const head = parts.slice(0, SERIES_COLORS.length).map((p, i) => ({
    key: `p${p.id}`,
    label: p.name,
    color: SERIES_COLORS[i],
    values: p.series,
  }));
  const rest = parts.slice(SERIES_COLORS.length);
  if (rest.length === 0) return head;
  const values = rest[0].series.map((_, i) =>
    rest.every((p) => p.series[i] === null)
      ? null
      : rest.reduce((s, p) => s + (p.series[i] ?? 0), 0),
  );
  return [...head, { key: "other", label: "その他", color: OTHER_COLOR, values }];
}

export function AssetTrendCharts() {
  const { data, isLoading } = useQuery({
    queryKey: ["personal-assets-trend"],
    queryFn: async (): Promise<TrendResponse> =>
      (await (await fetch("/api/personal-assets/trend")).json()).data,
  });

  if (isLoading) {
    return (
      <div className="card mb-6">
        <LoadingSpinner />
      </div>
    );
  }
  if (!data || data.assets.length === 0) return null;

  const { months, currentKey } = data;
  const nowIndex = months.indexOf(currentKey);
  // 合計は今日の見積もり（総資産サマリの今月の実物資産と同じ数字）
  const asOf = asOfDateLabel(new Date());
  const counted = data.assets.filter((a) => a.countAsAsset && a.estimatedValue !== null);
  const totalNow =
    counted.length === 0 ? null : counted.reduce((s, a) => s + (a.estimatedValue ?? 0), 0);

  return (
    <SectionCard
      title="実物資産の評価額の推移"
      lead={ASSETS_HELP.trend}
      badge={<TrendBadge trend={trendOfSeries(months, currentKey, data.total)} />}
    >
      <p className="text-xs text-slate-500">合計（資産計上の資産・{asOf}）</p>
      <p className="text-2xl font-bold text-slate-800 tabular-nums mb-2">
        {totalNow === null ? "—" : yenShort(totalNow)}
      </p>
      <ValueLineChart
        months={months}
        currentKey={currentKey}
        series={[{ key: "total", label: "合計", color: SERIES_COLORS[0], values: data.total }]}
        height={240}
      />

      <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">資産ごとの推移</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {data.assets.map((a) => {
          const series: ChartSeries[] =
            a.parts.length > 0
              ? partSeries(a.parts)
              : [{ key: `a${a.id}`, label: a.name, color: SERIES_COLORS[0], values: a.series }];
          return (
            <div key={a.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  {PERSONAL_ASSET_CATEGORY_LABEL[a.category]}
                </span>
                <span className="text-sm font-medium text-slate-800">{a.name}</span>
                {!a.countAsAsset && (
                  <span className="text-[10px] text-amber-600">資産計上外（合計に含めない）</span>
                )}
                <span className="ml-auto">
                  <TrendBadge trend={trendOfSeries(months, currentKey, a.series)} />
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-1">
                {asOf}の見積もり{" "}
                <span className="font-medium text-slate-700 tabular-nums">
                  {a.estimatedValue === null ? "—" : yenShort(a.estimatedValue)}
                </span>
              </p>
              <ValueLineChart
                months={months}
                currentKey={currentKey}
                series={series}
                height={150}
                compact
              />
              {series.length > 1 && (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                  {series.map((s) => {
                    const v = s.values[nowIndex];
                    return (
                      <li key={s.key} className="flex items-center gap-1">
                        <span
                          className="inline-block w-2.5 h-0.5 rounded"
                          style={{ background: s.color }}
                          aria-hidden="true"
                        />
                        {s.label}
                        <span className="tabular-nums text-slate-700">
                          {v === null || v === undefined ? "—" : yenShort(v)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
