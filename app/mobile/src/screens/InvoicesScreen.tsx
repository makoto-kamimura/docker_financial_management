import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchInvoices, type Invoice } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number | string) =>
  Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  draft:  { label: "下書き",   bg: "#f1f5f9", color: "#64748b" },
  issued: { label: "発行済み", bg: "#dbeafe", color: "#1d4ed8" },
  paid:   { label: "入金済み", bg: "#d1fae5", color: "#065f46" },
};

export function InvoicesScreen() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setInvoices(await fetchInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalIssued = invoices
    .filter(i => i.status === "issued")
    .reduce((s, i) => s + Number(i.total), 0);

  if (loading) return <LoadingView />;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>未入金合計</Text>
        <Text style={s.summaryValue}>{yen(totalIssued)}</Text>
      </View>

      {invoices.length === 0 ? (
        <Text style={s.empty}>インボイスがありません</Text>
      ) : (
        invoices.map(inv => {
          const st = STATUS[inv.status] ?? STATUS.draft;
          return (
            <View key={inv.id} style={s.card}>
              <View style={s.header}>
                <Text style={s.invNo}>{inv.invoiceNumber}</Text>
                <View style={[s.badge, { backgroundColor: st.bg }]}>
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
              <Text style={s.customer}>{inv.customerName}</Text>
              <View style={s.footer}>
                <Text style={s.date}>発行: {inv.issueDate.slice(0, 10)}  期限: {inv.dueDate.slice(0, 10)}</Text>
                <Text style={s.total}>{yen(inv.total)}</Text>
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
  summaryCard: {
    backgroundColor: "#1d4ed8", borderRadius: 14, padding: 18, marginBottom: 16, alignItems: "center",
  },
  summaryLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 4 },
  summaryValue: { color: "#fff", fontSize: 22, fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  invNo: { fontSize: 12, color: "#64748b", fontFamily: "monospace" },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  customer: { fontSize: 15, fontWeight: "600", color: "#1e293b", marginBottom: 8 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 11, color: "#94a3b8" },
  total: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
});
