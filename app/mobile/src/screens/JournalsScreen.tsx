import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchJournals, type JournalEntry } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  draft:    { label: "下書き",   bg: "#f1f5f9", color: "#64748b" },
  pending:  { label: "承認待ち", bg: "#fef9c3", color: "#854d0e" },
  approved: { label: "承認済",   bg: "#d1fae5", color: "#065f46" },
  rejected: { label: "差戻し",   bg: "#fee2e2", color: "#991b1b" },
};

export function JournalsScreen() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setJournals(await fetchJournals(30));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingView />;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}
      {journals.length === 0 ? (
        <Text style={s.empty}>仕訳エントリがありません</Text>
      ) : (
        journals.map(j => {
          const st = STATUS[j.approvalStatus] ?? STATUS.draft;
          const debit  = j.details.filter(d => d.side === "debit");
          const credit = j.details.filter(d => d.side === "credit");
          const total  = debit.reduce((s, d) => s + d.amount, 0);
          return (
            <View key={j.id} style={s.card}>
              <View style={s.header}>
                <Text style={s.date}>{j.transactionDate.slice(0, 10)}</Text>
                <View style={[s.badge, { backgroundColor: st.bg }]}>
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
              <Text style={s.desc} numberOfLines={1}>{j.description}</Text>
              <View style={s.detailsRow}>
                <View style={s.side}>
                  <Text style={s.sideLabel}>借方</Text>
                  {debit.map((d, i) => (
                    <Text key={i} style={s.sideItem}>{d.account.name}</Text>
                  ))}
                </View>
                <View style={s.side}>
                  <Text style={s.sideLabel}>貸方</Text>
                  {credit.map((d, i) => (
                    <Text key={i} style={s.sideItem}>{d.account.name}</Text>
                  ))}
                </View>
                <Text style={s.amount}>{yen(total)}</Text>
              </View>
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
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  date: { fontSize: 12, color: "#64748b" },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  desc: { fontSize: 14, fontWeight: "500", color: "#1e293b", marginBottom: 8 },
  detailsRow: { flexDirection: "row", alignItems: "flex-start" },
  side: { flex: 1 },
  sideLabel: { fontSize: 10, color: "#94a3b8", marginBottom: 2 },
  sideItem: { fontSize: 12, color: "#334155" },
  amount: { fontSize: 14, fontWeight: "700", color: "#1e293b", alignSelf: "center" },
});
