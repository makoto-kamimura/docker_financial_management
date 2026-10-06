// 月ごとの値の推移の線グラフ（web 版 components/ValueLineChart.tsx と同じ描き方を react-native-svg で）。
// 資産管理の評価額、借入金の残高・金利で使う。今月までは実線、今月から先は見積もり・予測なので破線。
// 今月に縦の線を引く。軸は 1 本だけ（単位の違う値は別のグラフに分ける）。
// 系列が 2 つ以上なら、名前と今月の値を下に並べる（色だけで見分けさせない）。
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Polyline, Text as SvgText } from "react-native-svg";
import { yenShort } from "../format";
import { COLORS } from "./ui";

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };

// 系列の色（内訳の順に固定。3 色は色覚の違いでも見分けられる組み合わせ）
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
export const OTHER_COLOR = "#94a3b8";

const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;

const manAxis = (v: number) => `${Math.round(v / 10000).toLocaleString()}万`;

export function AssetValueChart({
  months,
  currentKey,
  series,
  height,
  formatValue = yenShort,
  formatAxis = manAxis,
  stepped = false,
}: {
  months: string[];
  currentKey: string;
  series: ChartSeries[];
  height: number;
  /** 系列の名前の横に出す今月の値（既定は円） */
  formatValue?: (v: number) => string;
  /** 縦軸の目盛（既定は万円） */
  formatAxis?: (v: number) => string;
  /** 階段線にする（金利など、ある日から切り替わる値） */
  stepped?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const nowIndex = months.indexOf(currentKey);
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const x = (i: number) => PAD_L + (months.length <= 1 ? 0 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => PAD_T + (1 - v / max) * (height - PAD_T - PAD_B);

  // 値のある点だけをつないだ折れ線。from〜to の範囲（両端を含む）で、途切れたら分ける
  const segments = (values: (number | null)[], from: number, to: number) => {
    const out: string[] = [];
    let cur: string[] = [];
    for (let i = from; i <= to; i++) {
      const v = values[i];
      if (v === null || v === undefined) {
        if (cur.length > 1) out.push(cur.join(" "));
        cur = [];
      } else {
        // 階段線: 前の点の高さのまま横に進んでから縦に変わる
        if (stepped && cur.length > 0) {
          const prev = values[i - 1] as number;
          cur.push(`${x(i)},${y(prev)}`);
        }
        cur.push(`${x(i)},${y(v)}`);
      }
    }
    if (cur.length > 1) out.push(cur.join(" "));
    return out;
  };
  const yearTicks = months.map((k, i) => ({ k, i })).filter(({ k }) => k.endsWith("-01"));

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {[0, 0.5, 1].map((r) => (
              <Line
                key={r}
                x1={PAD_L}
                x2={width - PAD_R}
                y1={y(max * r)}
                y2={y(max * r)}
                stroke="#eef2f7"
                strokeWidth={1}
              />
            ))}
            {[0.5, 1].map((r) => (
              <SvgText
                key={r}
                x={PAD_L - 4}
                y={y(max * r) + 3}
                fontSize={9}
                fill="#64748b"
                textAnchor="end"
              >
                {formatAxis(max * r)}
              </SvgText>
            ))}
            {yearTicks.map(({ k, i }) => (
              <SvgText
                key={k}
                x={x(i)}
                y={height - 4}
                fontSize={9}
                fill="#64748b"
                textAnchor="middle"
              >
                {k.slice(0, 4)}
              </SvgText>
            ))}
            {nowIndex >= 0 && (
              <Line
                x1={x(nowIndex)}
                x2={x(nowIndex)}
                y1={PAD_T}
                y2={height - PAD_B}
                stroke="#94a3b8"
                strokeWidth={1}
              />
            )}
            {series.map((s) =>
              segments(s.values, 0, Math.max(nowIndex, 0)).map((pts, j) => (
                <Polyline
                  key={`${s.key}-a${j}`}
                  points={pts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                />
              )),
            )}
            {series.map((s) =>
              segments(s.values, Math.max(nowIndex, 0), months.length - 1).map((pts, j) => (
                <Polyline
                  key={`${s.key}-e${j}`}
                  points={pts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )),
            )}
          </Svg>
        )}
      </View>
      {series.length > 1 && (
        <View style={st.legend}>
          {series.map((s) => {
            const v = s.values[nowIndex];
            return (
              <View key={s.key} style={st.legendItem}>
                <View style={[st.swatch, { backgroundColor: s.color }]} />
                <Text style={st.legendText}>
                  {s.label} {v === null || v === undefined ? "—" : formatValue(v)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 10, height: 2, borderRadius: 1 },
  legendText: { fontSize: 11, color: COLORS.text },
});
