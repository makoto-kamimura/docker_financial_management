import { useEffect, useState } from "react";
import {
  Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import {
  fetchBankAccounts, getAllocation, loadAllocation, resetAllocation, saveAllocation,
  type AllocationGroup, type AllocationItem, type BankAccount,
} from "../api";
import { LoadingView } from "../components/LoadingView";

const GROUP_ORDER: AllocationGroup[] = ["固定費", "生活費", "その他"];

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
  const [allocation, setAllocationState] = useState<AllocationItem[]>(() => getAllocation().map(i => ({ ...i })));
  const [allocDirty, setAllocDirty] = useState(false);

  async function load() {
    setError(null);
    try {
      setAccounts(await fetchBankAccounts());
      // サーバー側マスタの配分ルールを反映（未接続時は既定値のまま）
      setAllocationState((await loadAllocation()).map(i => ({ ...i })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateAllocPercent(key: string, field: "minPercent" | "maxPercent", text: string) {
    const digits = text.replace(/[^0-9]/g, "");
    setAllocDirty(true);
    setAllocationState(prev => prev.map(item => {
      if (item.key !== key) return item;
      if (field === "maxPercent") {
        return { ...item, maxPercent: digits === "" ? null : Number(digits) };
      }
      return { ...item, minPercent: digits === "" ? 0 : Number(digits) };
    }));
  }

  async function handleSaveAllocation() {
    try {
      await saveAllocation(allocation);
      setAllocDirty(false);
      Alert.alert("保存しました", "予算配分ルールを更新しました。");
    } catch (e) {
      Alert.alert("保存に失敗しました", e instanceof Error ? e.message : "通信エラーが発生しました。");
    }
  }

  function handleResetAllocation() {
    setAllocationState(resetAllocation().map(i => ({ ...i })));
    setAllocDirty(false);
  }

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

      <Text style={[s.sectionTitle, { marginTop: 24 }]}>予算配分ルール（FP推奨・手取り収入ベース）</Text>
      <Text style={s.hint}>予算画面の「収入・売上」タップ時に表示するおすすめ配分の割合（％）です。必要に応じて変更できます。</Text>

      {GROUP_ORDER.map(group => {
        const items = allocation.filter(i => i.group === group);
        if (items.length === 0) return null;
        return (
          <View key={group} style={s.allocGroup}>
            <Text style={s.allocGroupTitle}>{group}</Text>
            {items.map(item => (
              <View key={item.key} style={s.allocRow}>
                <Text style={s.allocLabel} numberOfLines={1}>{item.label}</Text>
                <View style={s.allocInputs}>
                  <TextInput
                    style={s.allocInput}
                    keyboardType="number-pad"
                    value={String(item.minPercent)}
                    onChangeText={t => updateAllocPercent(item.key, "minPercent", t)}
                  />
                  <Text style={s.allocSep}>〜</Text>
                  <TextInput
                    style={s.allocInput}
                    keyboardType="number-pad"
                    placeholder="上限なし"
                    placeholderTextColor="#cbd5e1"
                    value={item.maxPercent === null ? "" : String(item.maxPercent)}
                    onChangeText={t => updateAllocPercent(item.key, "maxPercent", t)}
                  />
                  <Text style={s.allocPct}>%</Text>
                </View>
              </View>
            ))}
          </View>
        );
      })}

      <View style={s.allocBtnRow}>
        <TouchableOpacity style={s.resetBtn} onPress={handleResetAllocation}>
          <Text style={s.resetBtnTxt}>デフォルトに戻す</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.saveBtn, !allocDirty && s.saveBtnDisabled]}
          onPress={handleSaveAllocation}
          disabled={!allocDirty}
        >
          <Text style={s.saveBtnTxt}>保存する</Text>
        </TouchableOpacity>
      </View>
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
  allocGroup:      { marginBottom: 14 },
  allocGroupTitle: { fontSize: 12, fontWeight: "700", color: "#4f46e5", marginBottom: 6 },
  allocRow:        { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  allocLabel:      { flex: 1, fontSize: 12, color: "#1e293b", marginRight: 8 },
  allocInputs:     { flexDirection: "row", alignItems: "center" },
  allocInput:      { width: 44, fontSize: 13, fontWeight: "600", color: "#1e293b", textAlign: "center", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6, paddingVertical: 4 },
  allocSep:        { fontSize: 12, color: "#94a3b8", marginHorizontal: 4 },
  allocPct:        { fontSize: 12, color: "#64748b", marginLeft: 4 },
  allocBtnRow:     { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 24 },
  resetBtn:        { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#fff" },
  resetBtnTxt:     { fontSize: 13, fontWeight: "600", color: "#64748b" },
  saveBtn:         { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#4f46e5" },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnTxt:      { fontSize: 13, fontWeight: "700", color: "#fff" },
});
