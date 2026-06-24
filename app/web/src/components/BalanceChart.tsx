"use client";

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

export type BalancePoint = { date: string; balances: Record<number, number> };
export type BalanceAccount = { id: number; name: string };

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

// 各口座の残高推移を折れ線で表示する。残高0ラインを基準線として描画。
export function BalanceChart({
  timeline,
  accounts,
}: {
  timeline: BalancePoint[];
  accounts: BalanceAccount[];
}) {
  // recharts 用にフラット化（各口座 id をキーに）
  const data = timeline.map((p) => {
    const row: Record<string, number | string> = { date: p.date };
    for (const a of accounts) row[`a${a.id}`] = p.balances[a.id] ?? 0;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis tickFormatter={(v) => `${Math.round(v / 10000)}万`} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => v.toLocaleString("ja-JP")} />
        <Legend />
        <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
        {accounts.map((a, i) => (
          <Line
            key={a.id}
            type="stepAfter"
            dataKey={`a${a.id}`}
            name={a.name}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
