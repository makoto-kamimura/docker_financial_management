import { View, Text, StyleSheet } from "react-native";
import Svg, { Line, Polyline, Circle, Rect, Text as SvgText } from "react-native-svg";

const man = (v: number) => {
  if (Math.abs(v) >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}千万`;
  if (Math.abs(v) >= 10_000)     return `${Math.round(v / 10_000)}万`;
  return String(Math.round(v));
};

export function TrendChart({
  actual,
  forecast,
  budget,
  labels,
  width  = 320,
  height = 180,
}: {
  actual:   number[];
  forecast: number[];
  budget?:  number[];
  labels?:  string[];
  width?:   number;
  height?:  number;
}) {
  const LABEL_W = 38;
  const LABEL_H = 18;
  const PAD_TOP = 8;
  const PAD_RIGHT = 8;
  const chartW = width - LABEL_W - PAD_RIGHT;
  const chartH = height - LABEL_H - PAD_TOP;

  const budgetVals = budget ?? [];
  const all = [...actual, ...forecast, ...budgetVals].filter(v => Number.isFinite(v));
  if (all.length === 0) return <View style={{ width, height }} />;

  const max  = Math.max(...all);
  const min  = Math.min(0, ...all);
  const range = max - min || 1;

  const totalPoints = Math.max(actual.length + forecast.length, budgetVals.length, 1);
  const stepX = chartW / Math.max(totalPoints - 1, 1);

  const toX = (i: number) => LABEL_W + i * stepX;
  const toY = (v: number) => PAD_TOP + chartH - ((v - min) / range) * chartH;

  // ── グリッドライン ──────────────────────────────────────
  const GRID_COUNT = 4;
  const gridLines = Array.from({ length: GRID_COUNT + 1 }, (_, i) => {
    const val = min + (range * i) / GRID_COUNT;
    const y = toY(val);
    return { y, val };
  });

  // ── 折れ線データ ────────────────────────────────────────
  const actualPts   = actual.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const forecastStart = actual.length - 1;
  const forecastPts = forecast.map((v, i) => ({ x: toX(forecastStart + i + 1), y: toY(v) }));
  const forecastLine = actualPts.length
    ? [actualPts[actualPts.length - 1], ...forecastPts]
    : forecastPts;

  // ── 予算バー ────────────────────────────────────────────
  const barW = Math.max(stepX * 0.35, 4);
  const zero = toY(0);

  const pts2str = (pts: { x: number; y: number }[]) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <View>
      <Svg width={width} height={height}>
        {/* グリッドライン */}
        {gridLines.map(({ y, val }, i) => (
          <SvgText
            key={`gl${i}`}
            x={LABEL_W - 4}
            y={y + 4}
            textAnchor="end"
            fontSize={9}
            fill="#94a3b8"
          >
            {man(val)}
          </SvgText>
        ))}
        {gridLines.map(({ y }, i) => (
          <Line
            key={`g${i}`}
            x1={LABEL_W}
            y1={y}
            x2={width - PAD_RIGHT}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth={1}
            strokeDasharray={i === 0 ? undefined : "3,3"}
          />
        ))}

        {/* 予算バー */}
        {budgetVals.map((v, i) => {
          const x  = toX(i);
          const y  = Math.min(toY(v), zero);
          const bh = Math.abs(toY(v) - zero);
          return (
            <Rect
              key={`b${i}`}
              x={x - barW}
              y={y}
              width={barW}
              height={Math.max(bh, 1)}
              fill="#c7d2fe"
              opacity={0.8}
            />
          );
        })}

        {/* 実績バー */}
        {actualPts.map((p, i) => {
          const y  = Math.min(p.y, zero);
          const bh = Math.abs(p.y - zero);
          return (
            <Rect
              key={`ab${i}`}
              x={p.x}
              y={y}
              width={barW}
              height={Math.max(bh, 1)}
              fill="#6366f1"
              opacity={0.85}
            />
          );
        })}

        {/* 予測折れ線 */}
        {forecastLine.length > 1 && (
          <Polyline
            points={pts2str(forecastLine)}
            fill="none"
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="5,4"
          />
        )}

        {/* X軸ラベル */}
        {(labels ?? actual.map((_, i) => String(i + 1))).map((lb, i) => (
          <SvgText
            key={`xl${i}`}
            x={toX(i)}
            y={height - 2}
            textAnchor="middle"
            fontSize={8}
            fill="#94a3b8"
          >
            {lb}
          </SvgText>
        ))}
      </Svg>

      {/* 凡例 */}
      <View style={s.legend}>
        {budgetVals.length > 0 && (
          <View style={s.legendItem}>
            <View style={[s.legendBox, { backgroundColor: "#c7d2fe" }]} />
            <Text style={s.legendText}>予算</Text>
          </View>
        )}
        <View style={s.legendItem}>
          <View style={[s.legendBox, { backgroundColor: "#6366f1" }]} />
          <Text style={s.legendText}>実績</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendBox, { backgroundColor: "#f97316", opacity: 0.8 }]} />
          <Text style={s.legendText}>予測</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: "row", gap: 12, marginTop: 6, paddingLeft: 38 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendBox: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 10, color: "#6b7280" },
});
