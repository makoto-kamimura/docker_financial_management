import { StyleSheet, Text, View } from "react-native";

// 月別カテゴリ内訳（万円）の積み上げ棒グラフ。web 版ダッシュボードの BarChart と同じ内容で、
// 実績が未入力の月（予測値）は薄い色で描く。
export type CategoryMonth = { key: string; isForecast: boolean } & Record<string, unknown>;

type Props = {
  months: CategoryMonth[];
  categories: string[];
  colors: Record<string, string>;
  labels: Record<string, string>;
  /** 棒の下に出す月ラベル（"YYYY-MM" → 表示文字列） */
  monthLabel: (key: string) => string;
  height?: number;
};

const valueOf = (m: CategoryMonth, cat: string) => Math.max(0, Number(m[cat] ?? 0));

export function MonthlyCategoryChart({
  months,
  categories,
  colors,
  labels,
  monthLabel,
  height = 160,
}: Props) {
  const max = Math.max(1, ...months.map((m) => categories.reduce((s, c) => s + valueOf(m, c), 0)));

  return (
    <View>
      <Text style={s.axisNote}>最大 {Math.round(max / 10_000).toLocaleString("ja-JP")}万円</Text>
      <View style={[s.plot, { height }]}>
        {months.map((m) => (
          <View key={m.key} style={s.column}>
            {/* 上から積むと見た目が逆になるので、カテゴリ順の逆に並べて下詰めにする */}
            <View style={[s.stack, { opacity: m.isForecast ? 0.4 : 1 }]}>
              {[...categories].reverse().map((c) => {
                const v = valueOf(m, c);
                if (v === 0) return null;
                return (
                  <View
                    key={c}
                    style={{ height: (v / max) * height, backgroundColor: colors[c] ?? "#cbd5e1" }}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <View style={s.labelRow}>
        {months.map((m) => (
          <Text key={m.key} style={[s.monthLabel, m.isForecast && s.monthLabelForecast]}>
            {monthLabel(m.key)}
          </Text>
        ))}
      </View>
      <View style={s.legend}>
        {categories.map((c) => (
          <View key={c} style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: colors[c] ?? "#cbd5e1" }]} />
            <Text style={s.legendText}>{labels[c] ?? c}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  axisNote: { fontSize: 9, color: "#94a3b8", marginBottom: 4 },
  plot: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    gap: 2,
  },
  column: { flex: 1, justifyContent: "flex-end" },
  stack: { justifyContent: "flex-end", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  labelRow: { flexDirection: "row", gap: 2, marginTop: 4 },
  monthLabel: { flex: 1, fontSize: 8, color: "#64748b", textAlign: "center" },
  monthLabelForecast: { color: "#f97316" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 10, color: "#475569" },
});
