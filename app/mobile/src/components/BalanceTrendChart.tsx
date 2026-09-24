// 口座残高の推移（web 版 components/BalanceTrendChart.tsx と同じ内容を react-native-svg で描く）。
// 実線＝実績、破線＝資金移動ルールからの推測。対象年月に基準線を引く。月次（月末残高）と日次を切り替えられる。
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Polyline, Text as SvgText } from "react-native-svg";
import type { BalanceTrendPoint, TrendGranularity } from "../api";

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];
const H = 180;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 22;

const pointKey = (p: BalanceTrendPoint) => p.date ?? p.month ?? "";
// "2026-08" → "26/08" ／ "2026-08-03" → "08/03"
const axisLabel = (key: string) =>
  key.length > 7
    ? `${key.slice(5, 7)}/${key.slice(8, 10)}`
    : `${key.slice(2, 4)}/${key.slice(5, 7)}`;
const man = (v: number) => `${Math.round(v / 10_000).toLocaleString("ja-JP")}万`;

type Props = {
  points: BalanceTrendPoint[];
  accounts: { id: number; name: string }[];
  /** 対象年月（"YYYY-MM"）。基準線を引く */
  targetMonth: string;
  granularity: TrendGranularity;
};

export function BalanceTrendChart({ points, accounts, targetMonth, granularity }: Props) {
  if (points.length === 0) return <Text style={s.empty}>表示できるデータがありません</Text>;

  // 日次は点が多いので 1 点あたりの幅を詰め、横スクロールで見る
  const step = granularity === "day" ? 4 : 26;
  const width = Math.max(300, PAD_L + PAD_R + step * (points.length - 1));
  const values = points.flatMap((p) => accounts.map((a) => p.balances[a.id] ?? 0));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => PAD_T + ((max - v) / span) * (H - PAD_T - PAD_B);

  // 実績と推測の境目（最後の実績点）。この点は両方の線に含めてつなげる
  const lastActual = points.map((p) => p.estimated).lastIndexOf(false);
  const targetIndex = points.findIndex((p) => pointKey(p).startsWith(targetMonth));
  const labelEvery = granularity === "day" ? 30 : 2;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={width} height={H}>
          {/* 0 円の線と上下の目盛 */}
          <Line x1={PAD_L} x2={width - PAD_R} y1={y(0)} y2={y(0)} stroke="#e2e8f0" />
          <SvgText x={PAD_L - 4} y={y(max) + 4} fontSize={9} fill="#94a3b8" textAnchor="end">
            {man(max)}
          </SvgText>
          <SvgText x={PAD_L - 4} y={y(min) + 4} fontSize={9} fill="#94a3b8" textAnchor="end">
            {man(min)}
          </SvgText>
          {targetIndex >= 0 && (
            <Line
              x1={x(targetIndex)}
              x2={x(targetIndex)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="#6366f1"
              strokeDasharray="3 3"
            />
          )}
          {accounts.map((a, ai) => {
            const color = COLORS[ai % COLORS.length];
            const coords = points.map((p, i) => `${x(i)},${y(p.balances[a.id] ?? 0)}`);
            const actual = lastActual >= 0 ? coords.slice(0, lastActual + 1) : [];
            const estimated = coords.slice(Math.max(0, lastActual));
            return [
              actual.length > 1 && (
                <Polyline
                  key={`a${a.id}`}
                  points={actual.join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              ),
              estimated.length > 1 && (
                <Polyline
                  key={`e${a.id}`}
                  points={estimated.join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              ),
            ];
          })}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <SvgText key={i} x={x(i)} y={H - 6} fontSize={9} fill="#64748b" textAnchor="middle">
                {axisLabel(pointKey(p))}
              </SvgText>
            ) : null,
          )}
        </Svg>
      </ScrollView>
      <View style={s.legend}>
        {accounts.map((a, ai) => (
          <View key={a.id} style={s.legendItem}>
            <View style={[s.swatch, { backgroundColor: COLORS[ai % COLORS.length] }]} />
            <Text style={s.legendText}>{a.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { fontSize: 13, color: "#94a3b8", textAlign: "center", paddingVertical: 24 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: "#475569" },
});
