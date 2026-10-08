"use client";

// 月ごとの値の推移の線グラフ（資産管理の評価額、借入金管理の残高・金利で共用）。
// 今月までは実線、今月から先は見積もり・予測なので破線。今月に縦の線を引く。軸は 1 本だけにする
// （単位の違う値は別のグラフに分ける）。

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
import { yenShort } from "@/lib/format";

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };

// 系列の色（順に固定。3 色は色覚の違いでも見分けられる組み合わせ）
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
export const OTHER_COLOR = "#94a3b8";

const manAxis = (v: number) => `${Math.round(v / 10000).toLocaleString()}万`;
const monthLabel = (key: string) => `${key.slice(0, 4)}年${Number(key.slice(5))}月`;

/**
 * 月ごとの線グラフ。今月までは実線、今月から先は破線（見積もり・予測）。今月に縦の線を引く。軸は 1 本。
 * 系列が 2 つ以上なら、ツールチップに名前を出す（色だけで見分けさせない）。
 */
export function ValueLineChart({
  months,
  currentKey,
  series,
  height,
  compact = false,
  formatValue = yenShort,
  formatAxis = manAxis,
  stepped = false,
}: {
  months: string[];
  currentKey: string;
  series: ChartSeries[];
  height: number;
  compact?: boolean;
  /** ツールチップの値（既定は円） */
  formatValue?: (v: number) => string;
  /** 縦軸の目盛（既定は万円） */
  formatAxis?: (v: number) => string;
  /** 階段線にする（金利など、ある日から切り替わる値） */
  stepped?: boolean;
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
          tickFormatter={formatAxis}
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
                      <span className="font-medium tabular-nums">{formatValue(s.values[i]!)}</span>
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
            type={stepped ? "stepAfter" : "linear"}
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
            type={stepped ? "stepAfter" : "linear"}
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
