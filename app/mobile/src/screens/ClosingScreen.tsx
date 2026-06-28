import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchClosing, type ClosingData } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

export function ClosingScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(y: number) {
    setError(null);
    setLoading(true);
    try {
      setData(await fetchClosing(y));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(year); }, [year]);

  if (loading && !refreshing) return <LoadingView />;

  const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(year); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.yearRow}>
        {YEARS.map(y => (
          <TouchableOpacity
            key={y}
            style={[s.yearBtn, y === year && s.yearBtnActive]}
            onPress={() => setYear(y)}
          >
            <Text style={[s.yearText, y === year && s.yearTextActive]}>{y}年</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {data && (
        <>
          <Text style={s.sectionTitle}>損益計算書（P/L）</Text>
          <View style={s.card}>
            {[
              ["売上高", data.pnl.revenueTotal],
              ["売上原価", -data.pnl.cogsTotal],
              ["売上総利益", data.pnl.grossProfit],
              ["販管費", -data.pnl.expenseTotal],
              ["当期純利益", data.pnl.netIncome],
            ].map(([label, value]) => (
              <View key={label as string} style={s.tableRow}>
                <Text style={s.tableLabel}>{label}</Text>
                <Text style={[s.tableValue, (value as number) < 0 && { color: "#dc2626" }]}>
                  {yen(value as number)}
                </Text>
              </View>
            ))}
          </View>

          <Text style={s.sectionTitle}>貸借対照表（B/S）</Text>
          <View style={s.card}>
            {[
              ["資産合計", data.bs.assetTotal],
              ["負債合計", data.bs.liabilityTotal],
              ["純資産", data.bs.equity],
            ].map(([label, value]) => (
              <View key={label as string} style={s.tableRow}>
                <Text style={s.tableLabel}>{label}</Text>
                <Text style={s.tableValue}>{yen(value as number)}</Text>
              </View>
            ))}
          </View>

          <Text style={s.sectionTitle}>経営指標</Text>
          <View style={s.card}>
            {[
              ["粗利率", pct(data.ratios.grossProfitRate)],
              ["営業利益率", pct(data.ratios.operatingMargin)],
              ["流動比率", pct(data.ratios.currentRatio)],
              ["自己資本比率", pct(data.ratios.equityRatio)],
            ].map(([label, value]) => (
              <View key={label as string} style={s.tableRow}>
                <Text style={s.tableLabel}>{label}</Text>
                <Text style={s.tableValue}>{value}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 12 },
  yearRow: { marginBottom: 16 },
  yearBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#f1f5f9", marginRight: 8,
  },
  yearBtnActive: { backgroundColor: "#4f46e5" },
  yearText: { fontSize: 13, color: "#64748b" },
  yearTextActive: { color: "#fff", fontWeight: "600" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 8, marginTop: 4 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  tableRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f8fafc",
  },
  tableLabel: { fontSize: 13, color: "#334155" },
  tableValue: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
});
