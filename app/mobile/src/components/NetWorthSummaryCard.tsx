// ホームの総資産サマリ（web 版 components/NetWorthSummaryCard.tsx と同じ）。
// KPI の対象月の時点で出す（時点は月末、今月なら今日。実物資産は評価額の推移の見積もり）。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchNetWorthSummary, type NetWorthSummary } from "../api";
import { yenShort } from "../format";
import { ASSETS_HELP } from "../shared/help-texts";
import { COLORS } from "./ui";

/** 「2026年8月末時点」「2026年10月6日時点」 */
function asOfLabel(s: NetWorthSummary) {
  const [y, m, d] = s.asOf.split("-").map(Number);
  return s.isCurrentMonth ? `${y}年${m}月${d}日時点` : `${y}年${m}月末時点`;
}

export function NetWorthSummaryCard({
  period,
  refreshKey,
}: {
  period: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<NetWorthSummary | null>(null);

  useEffect(() => {
    const [year, month] = period.split("-").map(Number);
    fetchNetWorthSummary(year, month)
      .then(setData)
      .catch(() => setData(null));
  }, [period, refreshKey]);

  if (!data) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>総資産サマリ（{asOfLabel(data)}）</Text>
      <Text style={s.note}>{ASSETS_HELP.netWorth}</Text>
      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statLabel}>総資産</Text>
          <Text style={[s.statValue, { color: "#059669" }]}>{yenShort(data.totalAssets)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>総負債</Text>
          <Text style={[s.statValue, { color: "#e11d48" }]}>{yenShort(data.totalLiabilities)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>純資産</Text>
          <Text style={[s.statValue, { color: data.netWorth >= 0 ? "#4f46e5" : "#dc2626" }]}>
            {yenShort(data.netWorth)}
          </Text>
        </View>
      </View>
      <View style={s.breakdown}>
        {data.breakdown
          .filter((b) => b.amount !== 0)
          .map((b) => (
            <Text key={b.key} style={s.breakdownItem}>
              {b.label}: <Text style={s.breakdownValue}>{yenShort(b.amount)}</Text>
            </Text>
          ))}
      </View>
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
  note: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginBottom: 10 },
  stats: { flexDirection: "row", marginBottom: 10 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, color: "#64748b", marginBottom: 2 },
  statValue: { fontSize: 17, fontWeight: "700" },
  breakdown: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 8,
  },
  breakdownItem: { fontSize: 11, color: "#64748b" },
  breakdownValue: { color: "#334155", fontWeight: "600" },
});
