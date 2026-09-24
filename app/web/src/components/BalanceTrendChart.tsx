"use client";

// 口座残高の推移（対象年月の前後 N か月）。実線＝実績、破線＝資金移動ルールからの推測。
// recharts で 1 本の線を途中から破線にはできないため、口座ごとに実績用と推測用の
// 2 系列を作り、境目の点だけ両方に値を入れて線がつながるようにしている。
//
// 月次（月末残高）と日次（その日の残高）を同じ期間で切り替えられる。日次は月次では
// 潰れてしまう月の途中の上下（給与の入金前後や引き落とし日など）を見るためのもの。

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = {
  /** 月次は "YYYY-MM"、日次は "YYYY-MM-DD" */
  month?: string;
  date?: string;
  balances: Record<number, number>;
  estimated: boolean;
};
export type TrendAccount = { id: number; name: string };
export type TrendGranularity = "month" | "day";

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;
// "2026-08" → "26/08" ／ "2026-08-03" → "08/03"
const pointKey = (p: TrendPoint) => p.date ?? p.month ?? "";
const axisLabel = (key: string) =>
  key.length > 7
    ? `${key.slice(5, 7)}/${key.slice(8, 10)}`
    : `${key.slice(2, 4)}/${key.slice(5, 7)}`;

export function BalanceTrendChart({
  points,
  accounts,
  targetMonth,
  granularity = "month",
}: {
  points: TrendPoint[];
  accounts: TrendAccount[];
  /** 対象年月（"YYYY-MM"）。基準線を引く */
  targetMonth: string;
  granularity?: TrendGranularity;
}) {
  // 実績と推測の境目（最後の実績点）。この点は両系列に値を入れて線を連結する
  const lastActual = [...points].reverse().find((p) => !p.estimated);
  const lastActualKey = lastActual ? pointKey(lastActual) : null;

  const data = points.map((p) => {
    const key = pointKey(p);
    // キー（"2026-08" / "2026-08-03"）をそのまま X 軸の値にする。日次は 13 か月分あると
    // MM/DD の表示が一巡して重複しうるため、目盛の文字だけ tickFormatter で短くする
    const row: Record<string, number | string | null> = { key };
    for (const a of accounts) {
      const v = p.balances[a.id] ?? 0;
      row[`a${a.id}`] = p.estimated ? null : v;
      row[`e${a.id}`] = p.estimated || key === lastActualKey ? v : null;
    }
    return row;
  });

  // 対象月の基準線。日次は対象月の 1 日に引く
  const targetTick = granularity === "day" ? `${targetMonth}-01` : targetMonth;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="key"
          tickFormatter={axisLabel}
          tick={{ fontSize: 11 }}
          minTickGap={granularity === "day" ? 32 : 8}
        />
        <YAxis
          tickFormatter={(v) => `${Math.round(v / 10000)}万`}
          tick={{ fontSize: 11 }}
          width={52}
        />
        <Tooltip
          formatter={(v: number, name: string) => [yen(v), name]}
          contentStyle={{ fontSize: 12 }}
          labelStyle={{ fontSize: 11 }}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        {/* 残高 0 ライン。割り込むと引き落とし不能になる */}
        <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
        {targetTick && (
          <ReferenceLine
            x={targetTick}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{ value: "対象月", fontSize: 10, fill: "#94a3b8" }}
          />
        )}
        {accounts.map((a, i) => (
          <Line
            key={`a${a.id}`}
            type="monotone"
            dataKey={`a${a.id}`}
            name={a.name}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
        {accounts.map((a, i) => (
          <Line
            key={`e${a.id}`}
            type="monotone"
            dataKey={`e${a.id}`}
            name={`${a.name}（推測）`}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
