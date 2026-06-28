import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import {
  fetchAccounts, fetchRecentHistory, postFinancialRecord,
  type Account, type RecentHistory,
} from "../api";

// ── ユーティリティ ─────────────────────────────────────────────────────
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const ACTION_LABEL: Record<string, string> = { create: "登録", update: "更新", delete: "削除" };
const ACTION_COLOR: Record<string, string> = { create: "#16a34a", update: "#d97706", delete: "#dc2626" };
const ACTION_BG:    Record<string, string> = { create: "#f0fdf4", update: "#fffbeb", delete: "#fef2f2" };

function buildCalendar(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── コンポーネント ─────────────────────────────────────────────────────
export function EntryScreen() {
  const today = new Date();
  const [tab, setTab] = useState<"calendar" | "history">("calendar");

  // カレンダー状態
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);

  // データ
  const [accounts,  setAccounts]  = useState<Account[]>([]);
  const [history,   setHistory]   = useState<RecentHistory[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  // 登録済み (year,month) セット — カレンダードット用
  const [recordedMonths, setRecordedMonths] = useState<Set<string>>(new Set());

  // モーダル
  const [modalDay,     setModalDay]     = useState<number | null>(null);
  const [accountCode,  setAccountCode]  = useState("");
  const [amount,       setAmount]       = useState("");
  const [saving,       setSaving]       = useState(false);
  const slideAnim = useRef(new Animated.Value(300)).current;

  async function load() {
    try {
      const [accs, hist] = await Promise.all([fetchAccounts(), fetchRecentHistory(60)]);
      setAccounts(accs);
      setHistory(hist);
      const months = new Set(hist.map(h => `${h.period.fiscalYear}-${h.period.month}`));
      setRecordedMonths(months);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openModal(day: number) {
    setModalDay(day);
    setAmount("");
    setAccountCode("");
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }

  function closeModal() {
    Animated.timing(slideAnim, { toValue: 400, duration: 220, useNativeDriver: true }).start(() => {
      setModalDay(null);
    });
  }

  async function handleSave() {
    if (!accountCode) { Alert.alert("入力エラー", "勘定科目を選択してください。"); return; }
    if (!amount || isNaN(Number(amount))) { Alert.alert("入力エラー", "有効な金額を入力してください。"); return; }
    setSaving(true);
    try {
      await postFinancialRecord({
        accountCode,
        fiscalYear: calYear,
        month: calMonth,
        amount: parseFloat(amount),
      });
      closeModal();
      await load();
      Alert.alert("登録完了", `${calYear}年${calMonth}月の実績を登録しました。`);
    } catch (e: unknown) {
      Alert.alert("登録失敗", e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  // 月ナビ
  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
  }

  const cells       = buildCalendar(calYear, calMonth);
  const hasRecord   = recordedMonths.has(`${calYear}-${calMonth}`);
  const todayKey    = `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`;
  const selectedAcc = accounts.find(a => a.code === accountCode);

  return (
    <View style={s.root}>
      {/* タブ */}
      <View style={s.tabRow}>
        {(["calendar", "history"] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabActiveTxt]}>
              {t === "calendar" ? "カレンダー" : "入力履歴"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#4f46e5" size="large" /></View>
      ) : tab === "calendar" ? (
        /* ── カレンダー ── */
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* 月ナビ */}
          <View style={s.monthNav}>
            <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
              <Text style={s.navBtnTxt}>◀</Text>
            </TouchableOpacity>
            <View style={s.monthCenter}>
              <Text style={s.monthLabel}>{calYear}年{calMonth}月</Text>
              {hasRecord && <View style={s.recordDot} />}
            </View>
            <TouchableOpacity style={s.navBtn} onPress={nextMonth}>
              <Text style={s.navBtnTxt}>▶</Text>
            </TouchableOpacity>
          </View>

          {/* 曜日ヘッダー */}
          <View style={s.dowRow}>
            {DOW.map((d, i) => (
              <Text key={d} style={[s.dowCell, i === 0 && s.sun, i === 6 && s.sat]}>{d}</Text>
            ))}
          </View>

          {/* 日付グリッド */}
          <View style={s.grid}>
            {cells.map((day, idx) => {
              if (day === null) return <View key={`e-${idx}`} style={s.dayCell} />;
              const dow   = idx % 7;
              const isToday = `${calYear}-${calMonth}-${day}` === todayKey;
              return (
                <TouchableOpacity key={day} style={s.dayCell} onPress={() => openModal(day)}>
                  <View style={[s.dayInner, isToday && s.todayInner]}>
                    <Text style={[
                      s.dayTxt,
                      dow === 0 && s.sunTxt,
                      dow === 6 && s.satTxt,
                      isToday && s.todayTxt,
                    ]}>
                      {day}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.hintBox}>
            <Text style={s.hintTxt}>日付をタップして{calYear}年{calMonth}月の実績を登録できます</Text>
          </View>
        </ScrollView>
      ) : (
        /* ── 入力履歴 ── */
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {history.length === 0 ? (
            <View style={s.empty}><Text style={s.emptyTxt}>まだ入力履歴はありません。</Text></View>
          ) : history.map(h => (
            <View key={h.historyId} style={s.histRow}>
              <View style={[s.badge, { backgroundColor: ACTION_BG[h.action] ?? "#f1f5f9" }]}>
                <Text style={[s.badgeTxt, { color: ACTION_COLOR[h.action] ?? "#374151" }]}>
                  {ACTION_LABEL[h.action] ?? h.action}
                </Text>
              </View>
              <View style={s.histInfo}>
                <Text style={s.histAcc}>{h.account.code} {h.account.name}</Text>
                <Text style={s.histPeriod}>{h.period.fiscalYear}年 {h.period.month}月</Text>
                <Text style={s.histDate}>{fmtDate(h.changedAt)}</Text>
              </View>
              <Text style={s.histAmt}>{h.amount.toLocaleString("ja-JP")}円</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── 入力モーダル ── */}
      <Modal
        visible={modalDay !== null}
        transparent
        animationType="none"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.kavRoot}
        >
          {/* 背景タップで閉じる */}
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal}>
            <View style={s.overlayBg} />
          </Pressable>

          <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
              {/* ヘッダー */}
              <View style={s.sheetHeader}>
                <View>
                  <Text style={s.sheetDate}>{calYear}年{calMonth}月{modalDay}日</Text>
                  <Text style={s.sheetSub}>実績を登録</Text>
                </View>
                <TouchableOpacity style={s.closeBtn} onPress={closeModal}>
                  <Text style={s.closeTxt}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* 勘定科目 */}
              <Text style={s.fieldLabel}>勘定科目</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.chipScroll}
                contentContainerStyle={s.chipRow}
              >
                {accounts.slice(0, 40).map(a => (
                  <TouchableOpacity
                    key={a.code}
                    style={[s.chip, accountCode === a.code && s.chipActive]}
                    onPress={() => setAccountCode(a.code)}
                  >
                    <Text style={[s.chipTxt, accountCode === a.code && s.chipActiveTxt]}>
                      {a.code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {selectedAcc && (
                <Text style={s.accName}>{selectedAcc.name}</Text>
              )}

              {/* 金額 */}
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>金額（円）</Text>
              <View style={s.amtRow}>
                <Text style={s.amtYen}>¥</Text>
                <TextInput
                  style={s.amtInput}
                  value={amount}
                  onChangeText={t => setAmount(t.replace(/[^0-9.]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor="#cbd5e1"
                  selectTextOnFocus
                />
              </View>

              {/* 登録ボタン */}
              <TouchableOpacity
                style={[s.saveBtn, saving && s.saveBtnOff]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnTxt}>登録する</Text>
                }
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const CELL_W = `${Math.floor(100 / 7)}%` as const;

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#f8fafc" },
  tabRow:        { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  tabBtn:        { flex: 1, paddingVertical: 11, alignItems: "center" },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: "#4f46e5" },
  tabTxt:        { fontSize: 13, fontWeight: "500", color: "#64748b" },
  tabActiveTxt:  { color: "#4f46e5", fontWeight: "700" },
  center:        { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:        { flex: 1 },
  scrollContent: { padding: 14 },

  // 月ナビ
  monthNav:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navBtn:      { padding: 10 },
  navBtnTxt:   { fontSize: 18, color: "#4f46e5" },
  monthCenter: { flexDirection: "row", alignItems: "center", gap: 6 },
  monthLabel:  { fontSize: 18, fontWeight: "700", color: "#1e293b" },
  recordDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: "#4f46e5" },

  // カレンダー
  dowRow:      { flexDirection: "row", marginBottom: 4 },
  dowCell:     { width: CELL_W, textAlign: "center", fontSize: 11, fontWeight: "600", color: "#94a3b8", paddingVertical: 4 },
  sun:         { color: "#ef4444" },
  sat:         { color: "#3b82f6" },
  grid:        { flexDirection: "row", flexWrap: "wrap" },
  dayCell:     { width: CELL_W, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  dayInner:    { width: "80%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 100 },
  todayInner:  { backgroundColor: "#4f46e5" },
  dayTxt:      { fontSize: 14, color: "#374151", fontWeight: "500" },
  sunTxt:      { color: "#ef4444" },
  satTxt:      { color: "#3b82f6" },
  todayTxt:    { color: "#fff", fontWeight: "700" },
  hintBox:     { marginTop: 16, paddingVertical: 10, alignItems: "center" },
  hintTxt:     { fontSize: 12, color: "#94a3b8" },

  // 履歴
  empty:       { alignItems: "center", paddingVertical: 40 },
  emptyTxt:    { color: "#94a3b8", fontSize: 14 },
  histRow:     { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, alignItems: "flex-start", borderWidth: 1, borderColor: "#f1f5f9" },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 10, marginTop: 2 },
  badgeTxt:    { fontSize: 11, fontWeight: "700" },
  histInfo:    { flex: 1 },
  histAcc:     { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  histPeriod:  { fontSize: 11, color: "#64748b", marginTop: 2 },
  histDate:    { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  histAmt:     { fontSize: 14, fontWeight: "700", color: "#1e293b", alignSelf: "center" },

  // モーダル
  kavRoot:     { flex: 1, justifyContent: "flex-end" },
  overlayBg:   { flex: 1, backgroundColor: "rgba(15,23,42,0.5)" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 36 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  sheetDate:   { fontSize: 18, fontWeight: "700", color: "#1e293b" },
  sheetSub:    { fontSize: 12, color: "#64748b", marginTop: 2 },
  closeBtn:    { padding: 6 },
  closeTxt:    { fontSize: 18, color: "#94a3b8" },
  fieldLabel:  { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 8 },
  chipScroll:  { flexGrow: 0 },
  chipRow:     { flexDirection: "row", gap: 6, paddingBottom: 4 },
  chip:        { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive:  { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  chipTxt:     { fontSize: 12, color: "#374151" },
  chipActiveTxt: { color: "#fff", fontWeight: "600" },
  accName:     { fontSize: 13, color: "#4f46e5", fontWeight: "600", marginTop: 6 },
  amtRow:      { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, backgroundColor: "#f8fafc" },
  amtYen:      { fontSize: 18, color: "#64748b", marginRight: 4 },
  amtInput:    { flex: 1, fontSize: 24, fontWeight: "700", color: "#1e293b", paddingVertical: 12 },
  saveBtn:     { backgroundColor: "#4f46e5", borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 20 },
  saveBtnOff:  { opacity: 0.6 },
  saveBtnTxt:  { fontSize: 16, fontWeight: "700", color: "#fff" },
});
