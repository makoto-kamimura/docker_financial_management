// ホームの口座残高サマリ（web 版 components/BankSummaryCard.tsx と同じ）。
// KPI の対象月の時点（月末、今月なら今日）の総残高・口座数・最終更新と、口座ごとの残高。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchBankSummary, type BankSummary } from "../api";
import { fmtDateTime, yenShort } from "../format";
import { DASHBOARD_HELP } from "../shared/help-texts";
import { COLORS } from "./ui";

/** 「2026年8月末時点」「2026年10月6日時点」 */
function asOfLabel(s: BankSummary) {
  const [y, m, d] = s.asOf.split("-").map(Number);
  return s.isCurrentMonth ? `${y}年${m}月${d}日時点` : `${y}年${m}月末時点`;
}

export function BankSummaryCard({ period, refreshKey }: { period: string; refreshKey: number }) {
  const [data, setData] = useState<BankSummary | null>(null);

  useEffect(() => {
    const [year, month] = period.split("-").map(Number);
    fetchBankSummary(year, month)
      .then(setData)
      .catch(() => setData(null));
  }, [period, refreshKey]);

  if (!data || data.accounts.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>口座残高サマリ（{asOfLabel(data)}）</Text>
      <Text style={s.note}>{DASHBOARD_HELP.bankSummary}</Text>
      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statLabel}>総残高</Text>
          <Text style={[s.statValue, { color: "#4f46e5" }]}>{yenShort(data.totalBalance)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>口座数</Text>
          <Text style={s.statValue}>{data.accounts.length}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>最終更新</Text>
          <Text style={s.statSmall}>
            {data.lastUpdatedAt ? fmtDateTime(data.lastUpdatedAt) : "—"}
          </Text>
        </View>
      </View>
      {data.accounts.map((a) => (
        <View key={a.id} style={s.row}>
          <Text style={s.rowName}>
            {a.name}（{a.bankName}）
          </Text>
          <Text style={s.rowAmount}>{yenShort(a.balance)}</Text>
        </View>
      ))}
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
  statValue: { fontSize: 17, fontWeight: "700", color: "#1e293b" },
  statSmall: { fontSize: 12, fontWeight: "700", color: "#1e293b", marginTop: 3 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingVertical: 6,
  },
  rowName: { fontSize: 12, color: "#334155", flexShrink: 1 },
  rowAmount: { fontSize: 12, color: "#334155", fontWeight: "600" },
});
