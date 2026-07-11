import { useEffect, useState } from "react";
import {
  Dimensions, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import {
  fetchAccounts, fetchBudgetActual, fetchKpi, matchesViewMode,
  type BudgetActualRow, type KpiData, type ViewMode,
} from "../api";
import { TrendChart } from "../TrendChart";
import { LoadingView } from "../components/LoadingView";

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = SCREEN_W - 64;

const yen = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";
const pct = (v: number | null) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";

type KpiLabels = { revenue: string; profit: string; profitRate: string; ytd: string };
const MODE_KPI_LABELS: Record<ViewMode, KpiLabels> = {
  household: { revenue: "収入",   profit: "貯蓄額",   profitRate: "貯蓄率",     ytd: "YTD 収入" },
  sole:      { revenue: "売上",   profit: "事業利益", profitRate: "事業利益率", ytd: "YTD 売上" },
  corporate: { revenue: "売上高", profit: "営業利益", profitRate: "営業利益率", ytd: "YTD 売上高" },
};

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

type Props = { viewMode: ViewMode };

export function DashboardScreen({ viewMode }: Props) {
  const [kpi,         setKpi]         = useState<KpiData | null>(null);
  const [rows,        setRows]        = useState<BudgetActualRow[]>([]);
  const [baAccount,   setBaAccount]   = useState<string | null>(null);
  const [chartMode,   setChartMode]   = useState<"monthly" | "annual">("monthly");
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  // 表示モードに合った先頭の収益科目で予実データを取得する
  async function loadBudgetActual(): Promise<{ name: string; rows: BudgetActualRow[] } | null> {
    const accounts = await fetchAccounts();
    const revenue = accounts.find(
      a => a.category === "REVENUE" && matchesViewMode(a.code, viewMode),
    );
    if (!revenue) return null;
    const ba = await fetchBudgetActual(revenue.code);
    return { name: revenue.name, rows: ba.rows };
  }

  async function load() {
    setLoading(true);
    setError(null);
    // KPI（実績由来）と予実は独立に取得し、片方の失敗・未入力で画面全体を落とさない
    const [kpiRes, baRes] = await Promise.allSettled([fetchKpi(), loadBudgetActual()]);
    const k  = kpiRes.status === "fulfilled" ? kpiRes.value : null;
    const ba = baRes.status  === "fulfilled" ? baRes.value  : null;
    setKpi(k);
    setRows(ba?.rows ?? []);
    setBaAccount(ba?.name ?? null);
    if (kpiRes.status === "rejected" && baRes.status === "rejected") {
      setError("データの取得に失敗しました");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [viewMode]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function buildAnnual(inputRows: BudgetActualRow[]) {
    const byYear = new Map<string, { budget: number; actual: number; forecast: number }>();
    for (const r of inputRows) {
      const y = r.period.slice(0, 4);
      const cur = byYear.get(y) ?? { budget: 0, actual: 0, forecast: 0 };
      cur.budget   += r.budget;
      cur.actual   += r.actual ?? 0;
      cur.forecast += r.forecast ?? 0;
      byYear.set(y, cur);
    }
    return Array.from(byYear.entries()).map(([year, v]) => ({ label: year, ...v }));
  }

  const isAnnual  = chartMode === "annual";
  const chartData = isAnnual
    ? buildAnnual(rows)
    : rows.map(r => ({
        label:    r.period.slice(5, 7) + "月",
        budget:   r.budget,
        actual:   r.actual ?? 0,
        forecast: r.forecast ?? 0,
      }));

  const labels       = chartData.map(r => r.label);
  const budgetVals   = chartData.map(r => r.budget);
  const actualVals   = chartData.map(r => r.actual);
  const forecastVals = chartData.filter(r => r.forecast > 0).map(r => r.forecast);

  const klabels = MODE_KPI_LABELS[viewMode];

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {loading ? (
        <LoadingView />
      ) : error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : !kpi && rows.length === 0 ? (
        <View style={s.noticeBox}>
          <Text style={s.noticeText}>予算・実績データが未登録です</Text>
        </View>
      ) : (
        <>
          {!kpi ? (
            <View style={s.noticeBox}>
              <Text style={s.noticeText}>実績が未入力のため KPI は表示できません</Text>
            </View>
          ) : (
          <>
          <Text style={s.period}>{kpi.period}</Text>

          {/* KPI カード */}
          {viewMode === "household" ? (
            <>
              <View style={s.kpiRow}>
                <KpiCard label={klabels.revenue} value={yen(kpi.revenue)}
                  sub={kpi.yoy != null ? `前年比 ${pct(kpi.yoy)}` : undefined} />
                <KpiCard label="支出" value={yen(kpi.revenue - kpi.operatingProfit)} color="#dc2626" />
              </View>
              <View style={s.kpiRow}>
                <KpiCard label={klabels.profit} value={yen(kpi.operatingProfit)}
                  color={kpi.operatingProfit >= 0 ? "#16a34a" : "#dc2626"}
                  sub={`${klabels.profitRate} ${(kpi.operatingMargin * 100).toFixed(1)}%`} />
                <KpiCard label={klabels.ytd} value={yen(kpi.ytd)} />
              </View>
            </>
          ) : (
            <>
              <View style={s.kpiRow}>
                <KpiCard label={klabels.revenue} value={yen(kpi.revenue)}
                  sub={kpi.yoy != null ? `前年比 ${pct(kpi.yoy)}` : undefined} />
                <KpiCard label="粗利" value={yen(kpi.grossProfit)}
                  sub={`粗利率 ${(kpi.grossMargin * 100).toFixed(1)}%`}
                  color={kpi.grossProfit >= 0 ? "#16a34a" : "#dc2626"} />
              </View>
              <View style={s.kpiRow}>
                <KpiCard label={klabels.profit} value={yen(kpi.operatingProfit)}
                  color={kpi.operatingProfit >= 0 ? "#16a34a" : "#dc2626"}
                  sub={`${klabels.profitRate} ${(kpi.operatingMargin * 100).toFixed(1)}%`} />
                <KpiCard label={klabels.ytd} value={yen(kpi.ytd)} />
              </View>
            </>
          )}

          <View style={s.kpiRow}>
            <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} />
            <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
          </View>
          </>
          )}

          {/* 予実対比チャート（予算・実績のどちらかがあれば表示） */}
          {rows.length > 0 && (
            <>
              {/* 月次/年次 トグル */}
              <View style={s.toggleRow}>
                {(["monthly", "annual"] as const).map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[s.toggleBtn, chartMode === m && s.toggleActive]}
                    onPress={() => setChartMode(m)}
                  >
                    <Text style={[s.toggleText, chartMode === m && s.toggleActiveText]}>
                      {m === "monthly" ? "月次" : "年次"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>{baAccount ?? klabels.revenue} 予実対比</Text>
                <TrendChart
                  actual={actualVals}
                  forecast={forecastVals}
                  budget={budgetVals}
                  labels={labels}
                  width={CHART_W}
                  height={170}
                />
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  period: { fontSize: 11, color: "#94a3b8", marginBottom: 10 },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: "#dc2626", fontSize: 13 },
  noticeBox: { backgroundColor: "#f1f5f9", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10 },
  noticeText: { color: "#64748b", fontSize: 13 },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  kpiLabel: { fontSize: 11, color: "#64748b", marginBottom: 4 },
  kpiValue: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  kpiSub: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  toggleRow: {
    flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 8,
    padding: 3, marginVertical: 12, alignSelf: "flex-start",
  },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  toggleActive: { backgroundColor: "#fff" },
  toggleText: { fontSize: 13, color: "#64748b" },
  toggleActiveText: { color: "#1e293b", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 10 },
});
