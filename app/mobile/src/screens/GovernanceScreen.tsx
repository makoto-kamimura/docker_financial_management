import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchOfficers, type Officer } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: string | null) =>
  v == null ? "—" : Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export function GovernanceScreen() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setOfficers(await fetchOfficers());
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
      <Text style={s.sectionTitle}>役員一覧</Text>

      {officers.length === 0 ? (
        <Text style={s.empty}>登録済みの役員がいません</Text>
      ) : (
        officers.map(o => (
          <View key={o.id} style={s.card}>
            <View style={s.header}>
              <Text style={s.name}>{o.name}</Text>
              <View style={s.badge}>
                <Text style={s.badgeText}>{o.title}</Text>
              </View>
            </View>
            <View style={s.row}>
              <Text style={s.metaLabel}>任期</Text>
              <Text style={s.metaValue}>{o.termStart.slice(0, 10)} 〜 {o.termEnd.slice(0, 10)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.metaLabel}>報酬</Text>
              <Text style={s.metaValue}>{yen(o.salary)}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 12 },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  name: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  badge: { backgroundColor: "#ede9fe", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, color: "#6d28d9", fontWeight: "600" },
  row: { flexDirection: "row", marginBottom: 4 },
  metaLabel: { fontSize: 12, color: "#94a3b8", width: 36 },
  metaValue: { fontSize: 12, color: "#334155" },
});
