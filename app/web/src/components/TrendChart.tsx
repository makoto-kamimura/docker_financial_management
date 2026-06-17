"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = {
  key: string; // 期間ラベル
  actual?: number; // 実績
  forecast?: number; // 予測
};

// 実績と予測を 1 つの折れ線グラフに重ねて表示する推移グラフ
export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="key" />
        <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
        <Tooltip formatter={(v: number) => v.toLocaleString("ja-JP")} />
        <Legend />
        <Line
          type="monotone"
          dataKey="actual"
          name="実績"
          stroke="#2563eb"
          strokeWidth={2}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="forecast"
          name="予測"
          stroke="#f97316"
          strokeWidth={2}
          strokeDasharray="5 5"
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
