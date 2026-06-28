import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchLoans, type Loan } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number | string) =>
  Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number | string) => `${Number(v).toFixed(2)}%`;

const STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: "返済中",   bg: "#dbeafe", color: "#1d4ed8" },
  completed: { label: "完済",     bg: "#d1fae5", color: "#065f46" },
  default:   { label: "延滞",     bg: "#fee2e2", color: "#991b1b" },
};

export function LoansScreen() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setLoans(await fetchLoans());
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalRemaining = loans.reduce((s, l) => s + Number(l.remainingAmount), 0);

  if (loading) return <LoadingView />;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <View style={s.totalCard}>
        <Text style={s.totalLabel}>借入残高合計</Text>
        <Text style={s.totalValue}>{yen(totalRemaining)}</Text>
      </View>

      {loans.length === 0 ? (
        <Text style={s.empty}>登録済みの借入金がありません</Text>
      ) : (
        loans.map(l => {
          const st = STATUS_LABEL[l.status] ?? STATUS_LABEL.active;
          const progress = Number(l.amount) > 0
            ? Math.max(0, Math.min(1, 1 - Number(l.remainingAmount) / Number(l.amount)))
            : 0;
          return (
            <View key={l.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.lenderName}>{l.lenderName}</Text>
                <View style={[s.badge, { backgroundColor: st.bg }]}>
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.colLabel}>借入額</Text>
                  <Text style={s.colValue}>{yen(l.amount)}</Text>
                </View>
                <View style={s.col}>
                  <Text style={s.colLabel}>残高</Text>
                  <Text style={[s.colValue, { color: "#dc2626" }]}>{yen(l.remainingAmount)}</Text>
                </View>
                <View style={s.col}>
                  <Text style={s.colLabel}>金利</Text>
                  <Text style={s.colValue}>{pct(l.interestRate)}</Text>
                </View>
              </View>

              <View style={s.progressBg}>
                <View style={[s.progressFill, { width: `${progress * 100}%` as unknown as number }]} />
              </View>
              <Text style={s.progressLabel}>{(progress * 100).toFixed(0)}% 返済済み</Text>

              <Text style={s.dates}>
                借入: {l.borrowedOn.slice(0, 10)} → 完済予定: {l.repaymentDate.slice(0, 10)}
              </Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 12 },
  totalCard: {
    backgroundColor: "#dc2626", borderRadius: 14, padding: 18, marginBottom: 16, alignItems: "center",
  },
  totalLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 4 },
  totalValue: { color: "#fff", fontSize: 24, fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  lenderName: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", marginBottom: 12 },
  col: { flex: 1 },
  colLabel: { fontSize: 11, color: "#94a3b8", marginBottom: 2 },
  colValue: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  progressBg: { height: 6, backgroundColor: "#f1f5f9", borderRadius: 3, marginBottom: 4 },
  progressFill: { height: 6, backgroundColor: "#4f46e5", borderRadius: 3 },
  progressLabel: { fontSize: 11, color: "#64748b", marginBottom: 8 },
  dates: { fontSize: 11, color: "#94a3b8" },
});
