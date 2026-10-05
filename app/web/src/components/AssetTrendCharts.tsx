"use client";

// 実物資産の評価額の推移（資産管理）。上に「資産計上」の合計、下に資産ごとの小さなグラフを並べる。
// データは GET /api/personal-assets/trend（月末ごと）。今月より先は見積もりなので破線で描く。
// 評価額を手で入れた点を通り、最後の点から先は価値の変わり方で見積もる（lib/asset-valuation.ts）。
// 内訳のある資産（土地と建物など）は、内訳ごとの線を重ねる（色は内訳の順に固定。4 つ目からは「その他」）。

import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { ASSETS_HELP } from "@/lib/help-texts";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "@/lib/labels";
import { TREND_LABEL, type ValueTrend } from "@/lib/asset-valuation";

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

// 系列の色（内訳の順に固定。3 色は色覚の違いでも見分けられる組み合わせ）
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const OTHER_COLOR = "#94a3b8";

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : `${Math.round(v).toLocaleString("ja-JP")}円`;
const monthLabel = (key: string) => `${key.slice(0, 4)}年${Number(key.slice(5))}月`;

type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };

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

/**
 * 月ごとの線グラフ。今月までは実線、今月から先は破線（見積もり）。今月に縦の線を引く。
 * 系列が 2 つ以上なら、名前と今の値を下に並べる（色だけで見分けさせない）。
 */
function ValueLineChart({
  months,
  currentKey,
  series,
  height,
  compact = false,
}: {
  months: string[];
  currentKey: string;
  series: ChartSeries[];
  height: number;
  compact?: boolean;
}) {
  const data = months.map((key, i) => {
    const row: Record<string, string | number | null> = { key };
    for (const s of series) {
      const v = s.values[i];
      row[`${s.key}_a`] = key <= currentKey ? v : null;
      row[`${s.key}_e`] = key >= currentKey ? v : null;
    }
    return row;
  });
  const yearTicks = months.filter((k) => k.endsWith("-01"));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#eef2f7" vertical={false} />
        <XAxis
          dataKey="key"
          ticks={yearTicks}
          tickFormatter={(k: string) => `${k.slice(0, 4)}`}
          tick={{ fontSize: compact ? 10 : 11, fill: "#64748b" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${Math.round(v / 10000).toLocaleString()}万`}
          tick={{ fontSize: compact ? 10 : 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          width={compact ? 48 : 60}
        />
        <Tooltip
          cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
          content={({ active, label, payload }) => {
            if (!active || !payload?.length) return null;
            const key = String(label);
            const i = months.indexOf(key);
            return (
              <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                <p className="text-slate-500 mb-0.5">
                  {monthLabel(key)}末{key > currentKey ? "（見込み）" : ""}
                </p>
                {series.map((s) =>
                  s.values[i] === null ? null : (
                    <p key={s.key} className="flex items-center gap-1.5 text-slate-700">
                      {series.length > 1 && (
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: s.color }}
                          aria-hidden="true"
                        />
                      )}
                      {series.length > 1 && <span className="text-slate-500">{s.label}</span>}
                      <span className="font-medium tabular-nums">{yen(s.values[i]!)}</span>
                    </p>
                  ),
                )}
              </div>
            );
          }}
        />
        <ReferenceLine
          x={currentKey}
          stroke="#94a3b8"
          label={
            compact ? undefined : { value: "今月", fontSize: 10, fill: "#64748b", position: "top" }
          }
        />
        {series.map((s) => (
          <Line
            key={`${s.key}_a`}
            type="linear"
            dataKey={`${s.key}_a`}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
        {series.map((s) => (
          <Line
            key={`${s.key}_e`}
            type="linear"
            dataKey={`${s.key}_e`}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
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
  const totalNow = data.total[nowIndex];

  return (
    <section aria-labelledby="asset-trend-title" className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 id="asset-trend-title" className="section-title">
          実物資産の評価額の推移
        </h2>
        <TrendBadge trend={trendOfSeries(months, currentKey, data.total)} />
      </div>
      <SectionLead className="mb-3">{ASSETS_HELP.trend}</SectionLead>

      <p className="text-xs text-slate-500">合計（資産計上の資産）・今月末の見込み</p>
      <p className="text-2xl font-bold text-slate-800 tabular-nums mb-2">
        {totalNow === null || totalNow === undefined ? "—" : yen(totalNow)}
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
                今の見積もり{" "}
                <span className="font-medium text-slate-700 tabular-nums">
                  {a.estimatedValue === null ? "—" : yen(a.estimatedValue)}
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
                          {v === null || v === undefined ? "—" : yen(v)}
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
    </section>
  );
}
