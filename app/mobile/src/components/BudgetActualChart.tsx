// ホームの「予算と実績」グラフ（web 版 components/BudgetActualChart.tsx と同じ内容）。
// 灰色の帯が予算、その上の細い棒が実績。帯の右端の縦線が予算の位置。
// 実績の色は有利＝青・不利＝赤（赤緑は色覚の違いで見分けにくいため使わない）、予算 0 は灰色。
// 色だけに頼らず「余り／超過」などのラベルと矢印、金額を文字で並べる。
// 整形は shared/budget-actual-chart.ts。ライブラリは使わず View の幅で描く。
import { StyleSheet, Text, View } from "react-native";
import type { BudgetVariance, ViewMode } from "../api";
import { yen } from "../format";
import { buildBudgetActualGroups, type BudgetActualBar } from "../shared/budget-actual-chart";
import { displayName } from "../shared/display-name";
import { DASHBOARD_HELP, textFor } from "../shared/help-texts";
import { COLORS } from "./ui";

const COLOR_GOOD = "#2a78d6";
const COLOR_BAD = "#d03b3b";
const COLOR_NEUTRAL = "#64748b";

function stateOf(bar: BudgetActualBar, expense: boolean) {
  if (bar.favorable === null) {
    return { color: COLOR_NEUTRAL, label: bar.plan === 0 ? "予算なし" : "予算どおり", arrow: "" };
  }
  const label = expense ? (bar.favorable ? "余り" : "超過") : bar.favorable ? "上振れ" : "不足";
  return {
    color: bar.favorable ? COLOR_GOOD : COLOR_BAD,
    label,
    arrow: bar.difference > 0 ? "▲" : "▼",
  };
}

function BarRow({
  bar,
  expense,
  strong,
}: {
  bar: BudgetActualBar;
  expense: boolean;
  strong?: boolean;
}) {
  const state = stateOf(bar, expense);
  const pct = (r: number) => `${Math.min(r, 1) * 100}%` as const;
  return (
    <View
      style={s.row}
      accessible
      accessibilityLabel={`${bar.label} 予算 ${yen(bar.plan)} 実績 ${yen(bar.actual)} ${state.label}`}
    >
      <View style={s.rowHead}>
        <Text style={[s.label, strong && s.labelStrong]} numberOfLines={1}>
          {bar.label}
        </Text>
        <Text style={s.values}>
          {yen(bar.actual)}
          <Text style={s.plan}> / {yen(bar.plan)}</Text>
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.planBar, { width: pct(bar.planRatio) }]} />
        {bar.plan > 0 && <View style={[s.planTick, { left: pct(bar.planRatio) }]} />}
        <View
          style={[s.actualBar, { width: pct(bar.actualRatio), backgroundColor: state.color }]}
        />
      </View>
      <Text style={s.state}>
        {state.arrow ? <Text style={{ color: state.color }}>{state.arrow} </Text> : null}
        {state.label}
        {bar.difference !== 0 && bar.plan !== 0 ? ` ${yen(Math.abs(bar.difference))}` : ""}
      </Text>
    </View>
  );
}

export function BudgetActualChart({
  viewMode,
  period,
  data,
}: {
  viewMode: ViewMode;
  /** 対象月（YYYY-MM） */
  period: string;
  data: BudgetVariance | null;
}) {
  const household = viewMode === "household";
  const month = Number(period.slice(5, 7));
  if (!data) return null;
  const groups = buildBudgetActualGroups(data.rows, (r) => displayName(r as never, viewMode), {
    revenue: household ? "収入の合計" : "売上・収入の合計",
    expense: household ? "支出の合計" : "費用の合計",
  });
  const hasBudget = data.rows.some((r) => r.plan !== 0);

  return (
    <View style={s.card}>
      <Text style={s.title}>
        予算と実績（{period.slice(0, 4)}年{month}月）
      </Text>
      <Text style={s.note}>{textFor(DASHBOARD_HELP.budgetActual, viewMode)}</Text>
      {!hasBudget ? (
        <Text style={s.empty}>{month}月の予算が未設定です。予算の画面で予算を入れてください。</Text>
      ) : (
        groups.map((g) => (
          <View key={g.kind} style={s.group}>
            <BarRow bar={g.total} expense={g.kind === "expense"} strong />
            {g.items.map((b) => (
              <BarRow
                key={b.accountId ?? `other-${g.kind}`}
                bar={b}
                expense={g.kind === "expense"}
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  title: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  note: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginBottom: 8 },
  empty: { fontSize: 12, color: COLORS.muted, marginVertical: 8 },
  group: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6, marginTop: 6 },
  row: { paddingVertical: 5 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 3 },
  label: { flex: 1, fontSize: 12, color: "#475569" },
  labelStrong: { fontWeight: "600", color: COLORS.text },
  values: { fontSize: 12, color: COLORS.text, fontVariant: ["tabular-nums"] },
  plan: { color: COLORS.muted },
  track: { height: 14, position: "relative" },
  planBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 4,
    backgroundColor: "#e2e8f0",
  },
  planTick: {
    position: "absolute",
    top: -2,
    bottom: -2,
    width: 2,
    marginLeft: -1,
    backgroundColor: "#334155",
  },
  actualBar: { position: "absolute", top: 4, bottom: 4, left: 0, borderRadius: 4 },
  state: { fontSize: 11, color: "#475569", marginTop: 2, textAlign: "right" },
});
