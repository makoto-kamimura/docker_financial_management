import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchAccounts, fetchRecentHistory, postFinancialRecord, type Account, type RecentHistory } from "../api";
import { LoadingView } from "../components/LoadingView";

const ACTION_LABEL: Record<string, string> = { create: "登録", update: "更新", delete: "削除" };
const ACTION_COLOR: Record<string, string> = { create: "#16a34a", update: "#d97706", delete: "#dc2626" };
const ACTION_BG: Record<string, string> = { create: "#f0fdf4", update: "#fffbeb", delete: "#fef2f2" };

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EntryScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<RecentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // フォーム
  const [tab, setTab] = useState<"form" | "history">("form");
  const [accountCode, setAccountCode] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [accs, hist] = await Promise.all([fetchAccounts(), fetchRecentHistory(30)]);
      setAccounts(accs);
      setHistory(hist);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSave() {
    if (!accountCode) { Alert.alert("入力エラー", "勘定科目を選択してください。"); return; }
    if (!amount || isNaN(Number(amount))) { Alert.alert("入力エラー", "有効な金額を入力してください。"); return; }
    setSaving(true);
    try {
      await postFinancialRecord({
        accountCode,
        fiscalYear: parseInt(year, 10),
        month: parseInt(month, 10),
        amount: parseFloat(amount),
      });
      Alert.alert("登録完了", "実績データを登録しました。");
      setAmount("");
      await load();
    } catch (e: unknown) {
      Alert.alert("登録失敗", e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>実績入力</Text>

      {/* タブ */}
      <View style={s.tabRow}>
        {(["form", "history"] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, tab === t && s.tabActiveText]}>
              {t === "form" ? "手入力" : "入力履歴"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingView message="勘定科目を読み込み中..." />
      ) : tab === "form" ? (
        /* ── 手入力フォーム ── */
        <View style={s.card}>
          <Text style={s.cardTitle}>新規登録</Text>

          <Text style={s.label}>勘定科目</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
            {accounts.slice(0, 30).map(a => (
              <TouchableOpacity
                key={a.code}
                style={[s.chip, accountCode === a.code && s.chipActive]}
                onPress={() => setAccountCode(a.code)}
              >
                <Text style={[s.chipText, accountCode === a.code && s.chipActiveText]}>
                  {a.code}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {accountCode ? (
            <Text style={s.selectedAccount}>
              {accounts.find(a => a.code === accountCode)?.name ?? ""}
            </Text>
          ) : null}

          <View style={s.inputRow}>
            <View style={s.inputHalf}>
              <Text style={s.label}>年度</Text>
              <TextInput
                style={s.input}
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
              />
            </View>
            <View style={s.inputHalf}>
              <Text style={s.label}>月</Text>
              <TextInput
                style={s.input}
                value={month}
                onChangeText={setMonth}
                keyboardType="number-pad"
                placeholder="1〜12"
              />
            </View>
          </View>

          <Text style={s.label}>金額（円）</Text>
          <TextInput
            style={s.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="例: 350000"
          />

          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>登録する</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        /* ── 入力履歴 ── */
        <View>
          {history.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>まだ入力履歴はありません。</Text>
            </View>
          ) : (
            history.map(h => (
              <View key={h.historyId} style={s.histRow}>
                <View style={[s.actionBadge, { backgroundColor: ACTION_BG[h.action] ?? "#f1f5f9" }]}>
                  <Text style={[s.actionText, { color: ACTION_COLOR[h.action] ?? "#374151" }]}>
                    {ACTION_LABEL[h.action] ?? h.action}
                  </Text>
                </View>
                <View style={s.histInfo}>
                  <Text style={s.histAccount}>{h.account.code} {h.account.name}</Text>
                  <Text style={s.histPeriod}>{h.period.fiscalYear}年 {h.period.month}月</Text>
                  <Text style={s.histDate}>{fmtDate(h.changedAt)}</Text>
                </View>
                <Text style={s.histAmount}>{h.amount.toLocaleString("en-US")}円</Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: "#0f172a" },
  tabRow: { flexDirection: "row", gap: 0, marginBottom: 16, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0" },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: "center", backgroundColor: "#f8fafc" },
  tabActive: { backgroundColor: "#4f46e5" },
  tabText: { fontSize: 14, color: "#64748b", fontWeight: "500" },
  tabActiveText: { color: "#fff", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 10 },
  chipScroll: { flexGrow: 0, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  chipText: { fontSize: 12, color: "#374151" },
  chipActiveText: { color: "#fff", fontWeight: "600" },
  selectedAccount: { fontSize: 13, color: "#4f46e5", fontWeight: "500", marginBottom: 4 },
  inputRow: { flexDirection: "row", gap: 10 },
  inputHalf: { flex: 1 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: "#fff" },
  saveBtn: { backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 13, alignItems: "center", marginTop: 20 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  emptyBox: { padding: 32, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  histRow: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, alignItems: "flex-start", shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 3, elevation: 1 },
  actionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 10, marginTop: 2 },
  actionText: { fontSize: 11, fontWeight: "700" },
  histInfo: { flex: 1 },
  histAccount: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  histPeriod: { fontSize: 11, color: "#64748b", marginTop: 2 },
  histDate: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  histAmount: { fontSize: 14, fontWeight: "700", color: "#1e293b", alignSelf: "center" },
});
