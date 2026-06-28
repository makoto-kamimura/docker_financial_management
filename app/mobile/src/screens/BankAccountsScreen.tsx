import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchBankAccounts, type BankAccount } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const ROLE_LABEL: Record<string, string> = {
  checking: "普通", savings: "定期", credit: "クレジット",
  investment: "投資", cash: "現金", other: "その他",
};

export function BankAccountsScreen() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      setAccounts(await fetchBankAccounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalBalance = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  if (loading) return <LoadingView />;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <View style={s.totalCard}>
        <Text style={s.totalLabel}>総残高</Text>
        <Text style={s.totalValue}>{yen(totalBalance)}</Text>
      </View>

      {accounts.length === 0 ? (
        <Text style={s.empty}>登録済み口座がありません</Text>
      ) : (
        accounts.map(a => (
          <View key={a.id} style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.accountName}>{a.name}</Text>
              <View style={s.roleBadge}>
                <Text style={s.roleText}>{ROLE_LABEL[a.role] ?? a.role}</Text>
              </View>
            </View>
            <Text style={s.bankName}>{a.bankName}</Text>
            <Text style={s.balance}>{yen(a.balance ?? 0)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  error: { color: "#dc2626", fontSize: 13, marginBottom: 12, textAlign: "center" },
  totalCard: {
    backgroundColor: "#4f46e5", borderRadius: 14, padding: 18, marginBottom: 16,
    alignItems: "center",
  },
  totalLabel: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginBottom: 4 },
  totalValue: { color: "#fff", fontSize: 26, fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 40 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  accountName: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  roleBadge: { backgroundColor: "#ede9fe", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { fontSize: 11, color: "#6d28d9", fontWeight: "600" },
  bankName: { fontSize: 12, color: "#64748b", marginBottom: 8 },
  balance: { fontSize: 20, fontWeight: "700", color: "#0f172a", textAlign: "right" },
});
