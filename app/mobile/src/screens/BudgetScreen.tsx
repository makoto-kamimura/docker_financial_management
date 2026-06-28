import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import {
  fetchAccounts, fetchBudgets, postBudget,
  type Account, type BudgetRow, type ViewMode,
} from "../api";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const BUDGETABLE = ["REVENUE", "COGS", "EXPENSE"];
const CAT_LABEL: Record<string, string> = {
  REVENUE: "収入・売上",
  COGS:    "売上原価",
  EXPENSE: "費用・支出",
};

function prefixOf(vm: ViewMode): (code: string) => boolean {
  if (vm === "household") return c => c.startsWith("H");
  if (vm === "corporate") return c => c.startsWith("C");
  return c => /^\d/.test(c);
}

const yen = (v: number) =>
  v === 0 ? "¥0"
  : Math.abs(v) >= 10_000
    ? `¥${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万`
    : `¥${v.toLocaleString("ja-JP")}`;

type Props = { viewMode: ViewMode };

export function BudgetScreen({ viewMode }: Props) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets,  setBudgets]  = useState<BudgetRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [edits,    setEdits]    = useState<Record<string, string>>({});
  const [saving,   setSaving]   = useState(false);

  async function load(y: number) {
    setLoading(true);
    setEdits({});
    try {
      const [accs, buds] = await Promise.all([fetchAccounts(), fetchBudgets(y)]);
      const match = prefixOf(viewMode);
      setAccounts(accs.filter(a => BUDGETABLE.includes(a.category) && match(a.code)));
      setBudgets(buds);
    } catch {
      // silent — list stays empty
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(year); }, [year, viewMode]);

  function budgetOf(code: string): number {
    const b = budgets.find(b => b.account?.code === code && b.period?.month === month);
    return b?.amount ?? 0;
  }

  function valFor(code: string): string {
    if (code in edits) return edits[code];
    const amt = budgetOf(code);
    return amt === 0 ? "" : String(amt);
  }

  async function handleSave() {
    const entries = Object.entries(edits).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        entries.map(([code, val]) =>
          postBudget({ accountCode: code, fiscalYear: year, month, amount: Number(val) || 0 })
        )
      );
      await load(year);
    } catch (e: unknown) {
      Alert.alert("保存エラー", e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  const hasEdits = Object.keys(edits).length > 0;

  const monthTotal = accounts.reduce((sum, a) => {
    const v = valFor(a.code);
    return sum + (v !== "" ? Number(v) : budgetOf(a.code));
  }, 0);

  const grouped = (["REVENUE", "COGS", "EXPENSE"] as const).flatMap(cat => {
    const items = accounts.filter(a => a.category === cat);
    return items.length > 0 ? [{ cat, items }] : [];
  });

  return (
    <View style={s.root}>
      {/* 年度切替 */}
      <View style={s.yearRow}>
        <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y - 1)}>
          <Text style={s.yearBtnTxt}>◀</Text>
        </TouchableOpacity>
        <Text style={s.yearLabel}>{year}年度</Text>
        <TouchableOpacity style={s.yearBtn} onPress={() => setYear(y => y + 1)}>
          <Text style={s.yearBtnTxt}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* 月次タブ */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.monthScroll}
        contentContainerStyle={s.monthRow}
      >
        {MONTHS.map(m => (
          <TouchableOpacity
            key={m}
            style={[s.pill, month === m && s.pillActive]}
            onPress={() => { setMonth(m); setEdits({}); }}
          >
            <Text style={[s.pillTxt, month === m && s.pillTxtActive]}>{m}月</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#4f46e5" size="large" /></View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* 月次合計カード */}
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>{year}年{month}月 予算合計</Text>
            <Text style={s.totalValue}>{yen(monthTotal)}</Text>
          </View>

          {/* 勘定科目別入力 */}
          {grouped.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTxt}>このモードに対応する勘定科目がありません</Text>
            </View>
          ) : grouped.map(({ cat, items }) => (
            <View key={cat} style={s.group}>
              <Text style={s.groupLabel}>{CAT_LABEL[cat]}</Text>
              {items.map(a => {
                const val    = valFor(a.code);
                const edited = a.code in edits;
                return (
                  <View key={a.code} style={[s.row, edited && s.rowEdited]}>
                    <View style={s.rowInfo}>
                      <Text style={s.rowCode}>{a.code}</Text>
                      <Text style={s.rowName} numberOfLines={1}>{a.name}</Text>
                    </View>
                    <View style={s.inputWrap}>
                      <Text style={s.yen}>¥</Text>
                      <TextInput
                        style={s.input}
                        keyboardType="number-pad"
                        value={val}
                        placeholder="0"
                        placeholderTextColor="#cbd5e1"
                        selectTextOnFocus
                        onChangeText={t =>
                          setEdits(prev => ({
                            ...prev,
                            [a.code]: t.replace(/[^0-9]/g, ""),
                          }))
                        }
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          <View style={{ height: hasEdits ? 88 : 24 }} />
        </ScrollView>
      )}

      {/* 保存バー（編集時のみ表示） */}
      {hasEdits && (
        <View style={s.saveBar}>
          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.saveBtnTxt}>保存する</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#f8fafc" },
  yearRow:       { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, gap: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  yearBtn:       { paddingHorizontal: 12, paddingVertical: 6 },
  yearBtnTxt:    { fontSize: 16, color: "#4f46e5" },
  yearLabel:     { fontSize: 17, fontWeight: "700", color: "#1e293b", minWidth: 80, textAlign: "center" },
  monthScroll:   { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", flexGrow: 0 },
  monthRow:      { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  pill:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9" },
  pillActive:    { backgroundColor: "#4f46e5" },
  pillTxt:       { fontSize: 12, fontWeight: "600", color: "#64748b" },
  pillTxtActive: { color: "#fff" },
  center:        { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:        { flex: 1 },
  scrollContent: { padding: 14 },
  totalCard:     { backgroundColor: "#4f46e5", borderRadius: 12, padding: 16, marginBottom: 14 },
  totalLabel:    { fontSize: 11, color: "#c7d2fe", marginBottom: 4 },
  totalValue:    { fontSize: 24, fontWeight: "700", color: "#fff" },
  group:         { marginBottom: 12 },
  groupLabel:    { fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, paddingLeft: 2 },
  row:           { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  rowEdited:     { borderColor: "#818cf8", backgroundColor: "#eef2ff" },
  rowInfo:       { flex: 1, marginRight: 8 },
  rowCode:       { fontSize: 10, color: "#94a3b8" },
  rowName:       { fontSize: 13, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  inputWrap:     { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 8, backgroundColor: "#fff", minWidth: 110 },
  yen:           { fontSize: 13, color: "#64748b", marginRight: 2 },
  input:         { fontSize: 14, fontWeight: "600", color: "#1e293b", paddingVertical: 6, minWidth: 80, textAlign: "right" },
  empty:         { alignItems: "center", paddingVertical: 32 },
  emptyTxt:      { fontSize: 13, color: "#94a3b8" },
  saveBar:       { position: "absolute", bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  saveBtn:       { backgroundColor: "#4f46e5", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt:    { fontSize: 15, fontWeight: "700", color: "#fff" },
});
