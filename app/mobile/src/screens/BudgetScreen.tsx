import { useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchBudgets, type BudgetRow } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";


export function BudgetScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(y: number) {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchBudgets(y);
      setBudgets(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(year); }, [year]);

  async function onRefresh() {
    setRefreshing(true);
    await load(year);
    setRefreshing(false);
  }

  // 勘定科目ごとに年間合計を集計
  type AccountSummary = { code: string; name: string; category: string; total: number };
  const byAccount = new Map<string, AccountSummary>();
  for (const b of budgets) {
    const code = b.account?.code ?? "";
    const name = b.account?.name ?? "";
    const category = b.account?.category ?? "";
    const existing = byAccount.get(code) ?? { code, name, category, total: 0 };
    existing.total += b.amount;
    byAccount.set(code, existing);
  }
  const summaries = [...byAccount.values()];
  const totalBudget = summaries.reduce((s, a) => s + a.total, 0);

  // 月別合計（棒グラフ用）
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return budgets.filter(b => b.period?.month === m).reduce((s, b) => s + b.amount, 0);
  });
  const maxMonth = Math.max(...monthlyTotals, 1);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>予算管理</Text>

      {/* 年切り替え */}
      <View style={s.yearRow}>
        <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y - 1)}>
          <Text style={s.yearBtnText}>◀</Text>
        </TouchableOpacity>
        <Text style={s.yearLabel}>{year}年度</Text>
        <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y + 1)}>
          <Text style={s.yearBtnText}>▶</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <LoadingView />
      ) : error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : budgets.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyText}>この年度の予算データはありません。</Text>
        </View>
      ) : (
        <>
          {/* 年間合計 */}
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>年間予算合計</Text>
            <Text style={s.totalValue}>{yen(totalBudget)}</Text>
          </View>

          {/* 月次バー */}
          <View style={s.card}>
            <Text style={s.cardTitle}>月次予算分布</Text>
            <View style={s.barChart}>
              {monthlyTotals.map((val, i) => (
                <View key={i} style={s.barCol}>
                  <View style={s.barTrack}>
                    <View style={[s.barFill, { height: `${(val / maxMonth) * 100}%` }]} />
                  </View>
                  <Text style={s.barLabel}>{i + 1}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 勘定科目別サマリー */}
          <View style={s.card}>
            <Text style={s.cardTitle}>勘定科目別 年間予算</Text>
            {summaries.map(a => (
              <View key={a.code} style={s.row}>
                <View style={s.rowLeft}>
                  <Text style={s.rowCode}>{a.code}</Text>
                  <Text style={s.rowName}>{a.name}</Text>
                </View>
                <Text style={s.rowAmount}>{yen(a.total)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: "#0f172a" },
  yearRow: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 16 },
  yearBtn: { padding: 8 },
  yearBtnText: { fontSize: 16, color: "#4f46e5" },
  yearLabel: { fontSize: 18, fontWeight: "700", color: "#1e293b" },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: "#dc2626", fontSize: 13 },
  emptyBox: { backgroundColor: "#f8fafc", borderRadius: 8, padding: 24, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  totalCard: { backgroundColor: "#4f46e5", borderRadius: 12, padding: 18, marginBottom: 14 },
  totalLabel: { fontSize: 12, color: "#c7d2fe", marginBottom: 4 },
  totalValue: { fontSize: 22, fontWeight: "700", color: "#fff" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 12 },
  barChart: { flexDirection: "row", height: 80, alignItems: "flex-end", gap: 4 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  barFill: { backgroundColor: "#818cf8", borderRadius: 3, width: "100%" },
  barLabel: { fontSize: 9, color: "#94a3b8", marginTop: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  rowLeft: {},
  rowCode: { fontSize: 10, color: "#94a3b8" },
  rowName: { fontSize: 14, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  rowAmount: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
});
