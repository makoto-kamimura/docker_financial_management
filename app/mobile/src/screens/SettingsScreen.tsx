import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchBankAccounts, type BankAccount } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const TYPE_LABEL: Record<string, string> = {
  checking: "普通預金", savings: "定期預金", credit: "クレジット",
  investment: "投資", cash: "現金", other: "その他",
};

export function SettingsScreen() {
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

  if (loading) return <LoadingView />;

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={s.error}>{error}</Text>}

      <Text style={s.sectionTitle}>登録済み銀行口座</Text>
      <Text style={s.hint}>口座の追加・編集は Web 版から行ってください。</Text>

      {accounts.length === 0 ? (
        <Text style={s.empty}>登録済み口座がありません</Text>
      ) : (
        accounts.map(a => (
          <View key={a.id} style={s.card}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.accountName}>{a.name}</Text>
                <Text style={s.bankName}>{a.bankName}  {TYPE_LABEL[a.accountType] ?? a.accountType}</Text>
              </View>
              <Text style={s.balance}>{yen(a.balance ?? 0)}</Text>
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
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  hint: { fontSize: 12, color: "#94a3b8", marginBottom: 16 },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 32 },
  card: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  row: { flexDirection: "row", alignItems: "center" },
  accountName: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginBottom: 2 },
  bankName: { fontSize: 12, color: "#64748b" },
  balance: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
});
