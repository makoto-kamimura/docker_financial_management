// 返済スケジュール（web 版 /loans のグラフと同じ内容を react-native-svg で描く）。
// 系列の計算は web と共有する shared/loan-schedule.ts の buildScheduleData を使う。
//   残高（左軸）… 今日までは実績返済を反映、今日以降は償還スケジュールからの予測
//   適用金利（右軸・任意）… 今日までは履歴どおり、今日以降は将来の改定＋履歴からの予測（破線）
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Polyline, Text as SvgText } from "react-native-svg";
import {
  balanceKey,
  LOAN_COLORS,
  rateForecastKey,
  rateKey,
  todayLabel,
  type ChartPoint,
  type Loan,
} from "../shared/loan-schedule";

const H = 200;
const PAD_L = 40;
const PAD_R = 40;
const PAD_T = 10;
const PAD_B = 22;
const STEP = 4; // 1 か月あたりの横幅（数十年のローンでも横スクロールで追える幅）

type Props = { loans: Loan[]; points: ChartPoint[]; showRates: boolean };

export function LoanScheduleChart({ loans, points, showRates }: Props) {
  if (points.length === 0) return null;
  const width = Math.max(320, PAD_L + PAD_R + STEP * (points.length - 1));
  const num = (p: ChartPoint, key: string) =>
    typeof p[key] === "number" ? (p[key] as number) : null;

  const maxBalance = Math.max(
    1,
    ...points.flatMap((p) => loans.map((l) => num(p, balanceKey(l.id)) ?? 0)),
  );
  const maxRate = Math.max(
    0.1,
    ...points.flatMap((p) =>
      loans.flatMap((l) => [num(p, rateKey(l.id)) ?? 0, num(p, rateForecastKey(l.id)) ?? 0]),
    ),
  );
  const x = (i: number) => PAD_L + i * STEP;
  const yBalance = (v: number) => PAD_T + (1 - v / maxBalance) * (H - PAD_T - PAD_B);
  const yRate = (v: number) => PAD_T + (1 - v / maxRate) * (H - PAD_T - PAD_B);

  // 値のある点だけをつないだ折れ線（系列ごとに途中で途切れる区間は分けて描く）
  const segments = (key: string, y: (v: number) => number) => {
    const out: string[][] = [];
    let cur: string[] = [];
    points.forEach((p, i) => {
      const v = num(p, key);
      if (v === null) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      } else cur.push(`${x(i)},${y(v)}`);
    });
    if (cur.length > 1) out.push(cur);
    return out;
  };

  const todayIndex = points.findIndex((p) => p.date === todayLabel());
  // 年の変わり目（1 月）にだけ目盛を出す
  const yearTicks = points
    .map((p, i) => ({ i, label: String(p.date) }))
    .filter(({ label }) => label.endsWith("/01"));
  const tickEvery = Math.max(1, Math.ceil(yearTicks.length / 8));

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={width} height={H}>
          <SvgText x={PAD_L - 4} y={PAD_T + 8} fontSize={9} fill="#94a3b8" textAnchor="end">
            {Math.round(maxBalance / 10_000).toLocaleString("ja-JP")}万
          </SvgText>
          <SvgText x={PAD_L - 4} y={H - PAD_B} fontSize={9} fill="#94a3b8" textAnchor="end">
            0
          </SvgText>
          {showRates && (
            <SvgText x={width - PAD_R + 4} y={PAD_T + 8} fontSize={9} fill="#94a3b8">
              {maxRate.toFixed(2)}%
            </SvgText>
          )}
          <Line x1={PAD_L} x2={width - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#e2e8f0" />
          {todayIndex >= 0 && (
            <>
              <Line
                x1={x(todayIndex)}
                x2={x(todayIndex)}
                y1={PAD_T}
                y2={H - PAD_B}
                stroke="#94a3b8"
                strokeDasharray="4 4"
              />
              <SvgText x={x(todayIndex) + 3} y={PAD_T + 8} fontSize={9} fill="#94a3b8">
                今日
              </SvgText>
            </>
          )}
          {loans.map((l, i) => {
            const color = LOAN_COLORS[i % LOAN_COLORS.length];
            return [
              ...segments(balanceKey(l.id), yBalance).map((seg, k) => (
                <Polyline
                  key={`b${l.id}-${k}`}
                  points={seg.join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              )),
              ...(showRates
                ? [
                    ...segments(rateKey(l.id), yRate).map((seg, k) => (
                      <Polyline
                        key={`r${l.id}-${k}`}
                        points={seg.join(" ")}
                        fill="none"
                        stroke={color}
                        strokeOpacity={0.7}
                        strokeWidth={1}
                      />
                    )),
                    ...segments(rateForecastKey(l.id), yRate).map((seg, k) => (
                      <Polyline
                        key={`rf${l.id}-${k}`}
                        points={seg.join(" ")}
                        fill="none"
                        stroke={color}
                        strokeOpacity={0.7}
                        strokeWidth={1}
                        strokeDasharray="4 3"
                      />
                    )),
                  ]
                : []),
            ];
          })}
          {yearTicks
            .filter((_, k) => k % tickEvery === 0)
            .map(({ i, label }) => (
              <SvgText
                key={label}
                x={x(i)}
                y={H - 6}
                fontSize={9}
                fill="#64748b"
                textAnchor="middle"
              >
                {label.slice(0, 4)}
              </SvgText>
            ))}
        </Svg>
      </ScrollView>
      <View style={s.legend}>
        {loans.map((l, i) => (
          <View key={l.id} style={s.legendItem}>
            <View style={[s.swatch, { backgroundColor: LOAN_COLORS[i % LOAN_COLORS.length] }]} />
            <Text style={s.legendText}>{l.lenderName}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: "#475569" },
});
