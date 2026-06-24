import { useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchForecast, fetchKpi, type ForecastResponse, type KpiData } from "../api";
import { TrendChart } from "../TrendChart";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

export function DashboardScreen() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [viewMode, setViewMode] = useState<"monthly" | "annual">("monthly");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      const [k, f] = await Promise.all([fetchKpi(), fetchForecast("H1000", 6)]);
      setKpi(k);
      setForecast(f);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
    }
  }

  useEffect(() => { load(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // 月次→年次集計（各年の合計）
  function buildAnnualActual(history: { key: string; total: number }[]): number[] {
    const byYear = new Map<string, number>();
    for (const h of history) {
      const year = h.key.split("-")[0];
      byYear.set(year, (byYear.get(year) ?? 0) + h.total);
    }
    return [...byYear.values()];
  }

  const actual = viewMode === "monthly"
    ? (forecast?.history.map((h) => h.total) ?? [])
    : buildAnnualActual(forecast?.history ?? []);
  const forecastData = viewMode === "monthly" ? (forecast?.forecast ?? []) : [];

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>ダッシュボード</Text>

      {error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : !kpi ? (
        <LoadingView />
      ) : (
        <>
          {/* KPI カード */}
          <View style={s.kpiRow}>
            <KpiCard label="売上高" value={yen(kpi.revenue)} sub={kpi.yoyRevenue != null ? `前年比 ${pct(kpi.yoyRevenue)}` : undefined} />
            <KpiCard label="純利益" value={yen(kpi.profit)} color={kpi.profit >= 0 ? "#16a34a" : "#dc2626"} />
          </View>
          <View style={s.kpiRow}>
            <KpiCard label="利益率" value={kpi.profitMargin.toFixed(1) + "%"} color={kpi.profitMargin >= 0 ? "#16a34a" : "#dc2626"} />
            <KpiCard label="YTD 売上" value={yen(kpi.ytdRevenue)} />
          </View>

          {/* 月次/年次 トグル */}
          <View style={s.toggleRow}>
            {(["monthly", "annual"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.toggleBtn, viewMode === m && s.toggleActive]}
                onPress={() => setViewMode(m)}
              >
                <Text style={[s.toggleText, viewMode === m && s.toggleActiveText]}>
                  {m === "monthly" ? "月次" : "年次"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* トレンドチャート */}
          {forecast && (
            <View style={s.card}>
              <Text style={s.cardTitle}>
                給与（夫）H1000 — {viewMode === "monthly" ? "月次推移" : "年次推移"}
              </Text>
              <TrendChart actual={actual} forecast={forecastData} width={320} height={160} />
              <View style={s.legend}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#2563eb" }]} />
                  <Text style={s.legendText}>実績</Text>
                </View>
                {viewMode === "monthly" && (
                  <View style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: "#f97316" }]} />
                    <Text style={s.legendText}>予測</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 16, color: "#0f172a" },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: "#dc2626", fontSize: 13 },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  kpiLabel: { fontSize: 11, color: "#64748b", marginBottom: 4 },
  kpiValue: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  kpiSub: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  toggleRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 8, padding: 3, marginVertical: 12, alignSelf: "flex-start" },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  toggleActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  toggleText: { fontSize: 13, color: "#64748b" },
  toggleActiveText: { color: "#1e293b", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 10 },
  legend: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: "#6b7280" },
});
