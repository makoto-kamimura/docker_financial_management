import { useEffect, useMemo, useState } from "react";
import {
  RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native";
import {
  fetchBankAccounts, fetchBankTransactions, fetchTransferFlow, fetchTransfers,
  type BankAccount, type BankTransaction, type Transfer,
} from "../api";
import { AccountFlowDiagram } from "../components/AccountFlowDiagram";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

type Tab = "flow" | "list" | "calendar";
const TABS: { id: Tab; label: string }[] = [
  { id: "flow", label: "フロー図" },
  { id: "list", label: "明細一覧" },
  { id: "calendar", label: "カレンダー" },
];

// ── フロー図 ─────────────────────────────────────────────────────────
function FlowTab() {
  const [data,    setData]    = useState<Awaited<ReturnType<typeof fetchTransferFlow>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchTransferFlow()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingView />;
  if (error)   return <Text style={[s.error, { margin: 16 }]}>{error}</Text>;
  if (!data || data.graph.nodes.length === 0) {
    return (
      <View style={{ alignItems: "center", padding: 32 }}>
        <Text style={s.empty}>口座間の資金移動が登録されていません</Text>
        <Text style={[s.empty, { fontSize: 12, marginTop: 6 }]}>
          カレンダータブで口座間フローを設定してください
        </Text>
      </View>
    );
  }
  if (data.cyclic) {
    return <Text style={[s.error, { margin: 16 }]}>循環参照が検出されました。移動設定を確認してください。</Text>;
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
      <AccountFlowDiagram graph={data.graph} />
    </ScrollView>
  );
}

// ── 明細一覧 ──────────────────────────────────────────────────────────
function ListTab() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const accs = await fetchBankAccounts();
      setAccounts(accs);
      const id = selectedId ?? (accs[0]?.id ?? null);
      if (id) {
        setSelectedId(id);
        setTxns(await fetchBankTransactions({ accountId: id }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function selectAccount(id: number) {
    setSelectedId(id);
    setLoading(true);
    try {
      setTxns(await fetchBankTransactions({ accountId: id }));
    } catch {
      setError("明細の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading && !refreshing) return <LoadingView />;

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {error && <Text style={[s.error, { margin: 16 }]}>{error}</Text>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.accountTabs}>
        {accounts.map(a => (
          <TouchableOpacity
            key={a.id}
            style={[s.accountTab, selectedId === a.id && s.accountTabActive]}
            onPress={() => selectAccount(a.id)}
          >
            <Text style={[s.accountTabText, selectedId === a.id && s.accountTabTextActive]}>{a.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {txns.length === 0 ? (
        <Text style={s.empty}>取引明細がありません</Text>
      ) : (
        txns.map(t => (
          <View key={t.id} style={s.txnRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.txnDate}>{t.date.slice(0, 10)}</Text>
              <Text style={s.txnDesc} numberOfLines={1}>{t.description}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.txnAmount, t.amount < 0 ? s.txnOut : s.txnIn]}>
                {t.amount < 0 ? "-" : "+"}{yen(Math.abs(t.amount))}
              </Text>
              {t.balance != null && <Text style={s.txnBalance}>{yen(t.balance)}</Text>}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ── カレンダー ────────────────────────────────────────────────────────
function CalendarTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransfers().then(setTransfers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<number, Transfer[]>();
    for (const t of transfers) {
      const arr = map.get(t.day) ?? [];
      arr.push(t);
      map.set(t.day, arr);
    }
    return map;
  }, [transfers]);

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  if (loading) return <LoadingView />;

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <ScrollView style={{ padding: 12 }}>
      <View style={s.calNav}>
        <TouchableOpacity onPress={prevMonth} style={s.calNavBtn}><Text style={s.calNavText}>‹</Text></TouchableOpacity>
        <Text style={s.calTitle}>{year}年 {month}月</Text>
        <TouchableOpacity onPress={nextMonth} style={s.calNavBtn}><Text style={s.calNavText}>›</Text></TouchableOpacity>
      </View>

      <View style={s.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={d} style={[s.weekDay, i === 0 && { color: "#dc2626" }, i === 6 && { color: "#2563eb" }]}>{d}</Text>
        ))}
      </View>

      <View style={s.calGrid}>
        {cells.map((day, i) => {
          const ts = day ? (byDay.get(day) ?? []) : [];
          return (
            <TouchableOpacity
              key={i}
              style={[s.calCell, day === selectedDay && s.calCellSelected, !day && s.calCellEmpty]}
              onPress={() => day && setSelectedDay(day === selectedDay ? null : day)}
              disabled={!day}
            >
              {day && (
                <>
                  <Text style={[s.calDayNum, day === selectedDay && { color: "#fff" }]}>{day}</Text>
                  {ts.slice(0, 2).map((t, j) => (
                    <View key={j} style={[s.calDot, t.direction === "out" ? s.calDotOut : s.calDotIn]} />
                  ))}
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedDay && (
        <View style={s.dayPanel}>
          <Text style={s.dayPanelTitle}>毎月 {selectedDay} 日</Text>
          {(byDay.get(selectedDay) ?? []).length === 0 ? (
            <Text style={s.empty}>登録なし</Text>
          ) : (
            (byDay.get(selectedDay) ?? []).map(t => (
              <View key={t.id} style={s.transferRow}>
                <Text style={[s.transferDir, t.direction === "out" ? s.out : s.inc]}>
                  {t.direction === "out" ? "支出" : "収入"}
                </Text>
                <Text style={s.transferLabel} numberOfLines={1}>{t.label}</Text>
                <Text style={s.transferAmount}>{yen(t.amount)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

// ── メイン ────────────────────────────────────────────────────────────
export function BankTransactionsScreen() {
  const [tab, setTab] = useState<Tab>("flow");

  return (
    <View style={{ flex: 1, backgroundColor: "#f8fafc" }}>
      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.id} style={[s.tabItem, tab === t.id && s.tabItemActive]} onPress={() => setTab(t.id)}>
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {tab === "flow" && <FlowTab />}
        {tab === "list" && <ListTab />}
        {tab === "calendar" && <CalendarTab />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  error: { color: "#dc2626", fontSize: 13, textAlign: "center" },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 14, marginTop: 32 },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: "#4f46e5" },
  tabText: { fontSize: 13, color: "#64748b" },
  tabTextActive: { color: "#4f46e5", fontWeight: "600" },
  // flow
  flowRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 14, backgroundColor: "#fff", borderRadius: 10, marginBottom: 8,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  flowRowHighlight: { backgroundColor: "#ede9fe", borderColor: "#c4b5fd" },
  flowLabel: { fontSize: 14, color: "#334155" },
  flowValue: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  // list
  accountTabs: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff" },
  accountTab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "#f1f5f9", marginRight: 8,
  },
  accountTabActive: { backgroundColor: "#4f46e5" },
  accountTabText: { fontSize: 13, color: "#64748b" },
  accountTabTextActive: { color: "#fff", fontWeight: "600" },
  txnRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  txnDate: { fontSize: 11, color: "#94a3b8", marginBottom: 2 },
  txnDesc: { fontSize: 13, color: "#334155" },
  txnAmount: { fontSize: 14, fontWeight: "700" },
  txnIn: { color: "#16a34a" },
  txnOut: { color: "#dc2626" },
  txnBalance: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  // calendar
  calNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  calNavBtn: { padding: 8 },
  calNavText: { fontSize: 22, color: "#4f46e5" },
  calTitle: { fontSize: 16, fontWeight: "600", color: "#1e293b" },
  weekRow: { flexDirection: "row", marginBottom: 4 },
  weekDay: { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: "600" },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calCell: {
    width: "14.28%", aspectRatio: 1, padding: 3, alignItems: "center",
    justifyContent: "flex-start", borderRadius: 6,
  },
  calCellSelected: { backgroundColor: "#4f46e5" },
  calCellEmpty: { opacity: 0 },
  calDayNum: { fontSize: 13, color: "#334155", fontWeight: "500" },
  calDot: { width: 6, height: 6, borderRadius: 3, marginTop: 1 },
  calDotOut: { backgroundColor: "#f43f5e" },
  calDotIn: { backgroundColor: "#10b981" },
  dayPanel: {
    marginTop: 12, backgroundColor: "#fff", borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#e2e8f0",
  },
  dayPanelTitle: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginBottom: 10 },
  transferRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  transferDir: { fontSize: 11, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 8, overflow: "hidden" },
  out: { backgroundColor: "#fee2e2", color: "#dc2626" },
  inc: { backgroundColor: "#d1fae5", color: "#16a34a" },
  transferLabel: { flex: 1, fontSize: 13, color: "#334155" },
  transferAmount: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
});
