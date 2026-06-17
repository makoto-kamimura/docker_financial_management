"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type BudgetActualPoint = {
  period: string;
  budget: number;
  actual: number | null;
  forecast: number | null;
};

// 予算（棒）と実績・予測（線）を重ねた予実対比の複合グラフ
export function BudgetActualChart({ data }: { data: BudgetActualPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
        <Tooltip formatter={(v: number) => v?.toLocaleString("ja-JP")} />
        <Legend />
        <Bar dataKey="budget" name="予算" fill="#cbd5e1" />
        <Line type="monotone" dataKey="actual" name="実績" stroke="#2563eb" strokeWidth={2} connectNulls />
        <Line
          type="monotone"
          dataKey="forecast"
          name="予測"
          stroke="#f97316"
          strokeWidth={2}
          strokeDasharray="5 5"
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
