import { useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Line, Polyline, Circle, Text as SvgText } from "react-native-svg";
import { fetchAssets, type AssetAccount } from "../api";
import { LoadingView } from "../components/LoadingView";

const yen = (v: number) =>
  v >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

/** そのyearで最後のmonthの残高（Web の latestBalance と同じロジック） */
function latestBalance(balances: AssetAccount["balances"], year: number): number {
  const ys = balances.filter((b) => b.fiscalYear === year);
  if (!ys.length) return 0;
  return ys.reduce((best, b) => (b.month > best.month ? b : best)).amount;
}

type TrendPoint = { year: number; asset: number; liab: number; net: number };

function leafOf(accounts: AssetAccount[], cat: "ASSET" | "LIABILITY"): AssetAccount[] {
  return accounts.filter(
    (a) => a.category === cat && !accounts.some((c) => c.parentId === a.id),
  );
}

function buildTrend(accounts: AssetAccount[], years: number[]): TrendPoint[] {
  const assetLeaves = leafOf(accounts, "ASSET");
  const liabLeaves = leafOf(accounts, "LIABILITY");
  return years.map((year) => {
    const asset = assetLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    const liab = liabLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    return { year, asset, liab, net: asset - liab };
  });
}

// ── SVG折れ線グラフ ────────────────────────────────────────────────────
const CHART_W = 320;
const CHART_H = 140;
const PAD = { top: 10, right: 10, bottom: 28, left: 50 };

function scalePoints(values: number[], min: number, max: number, count: number): string {
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = PAD.left + (i / Math.max(count - 1, 1)) * (CHART_W - PAD.left - PAD.right);
      const y = PAD.top + (1 - (v - min) / range) * (CHART_H - PAD.top - PAD.bottom);
      return `${x},${y}`;
    })
    .join(" ");
}

function AssetTrendChart({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) return null;
  const allVals = trend.flatMap((t) => [t.asset, t.liab, t.net]);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const count = trend.length;

  const assets = trend.map((t) => t.asset);
  const liabs = trend.map((t) => t.liab);
  const nets = trend.map((t) => t.net);

  const axisY = PAD.top + (CHART_H - PAD.top - PAD.bottom);
  const axisX = PAD.left;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* 軸 */}
      <Line x1={axisX} y1={PAD.top} x2={axisX} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
      <Line x1={axisX} y1={axisY} x2={CHART_W - PAD.right} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />

      {/* 折れ線 */}
      <Polyline
        points={scalePoints(assets, minVal, maxVal, count)}
        fill="none"
        stroke="#10b981"
        strokeWidth={2}
      />
      <Polyline
        points={scalePoints(liabs, minVal, maxVal, count)}
        fill="none"
        stroke="#f43f5e"
        strokeWidth={2}
      />
      <Polyline
        points={scalePoints(nets, minVal, maxVal, count)}
        fill="none"
        stroke="#6366f1"
        strokeWidth={2.5}
      />

      {/* X軸ラベル（年） */}
      {trend.map((t, i) => {
        const x = PAD.left + (i / Math.max(count - 1, 1)) * (CHART_W - PAD.left - PAD.right);
        return (
          <SvgText
            key={t.year}
            x={x}
            y={CHART_H - 4}
            fontSize={9}
            textAnchor="middle"
            fill="#94a3b8"
          >
            {t.year}
          </SvgText>
        );
      })}

      {/* 純資産の最終値ドット */}
      {(() => {
        const last = trend[trend.length - 1];
        const x = CHART_W - PAD.right;
        const range = maxVal - minVal || 1;
        const y = PAD.top + (1 - (last.net - minVal) / range) * (CHART_H - PAD.top - PAD.bottom);
        return <Circle cx={x} cy={y} r={3} fill="#6366f1" />;
      })()}
    </Svg>
  );
}

// ── メイン画面 ─────────────────────────────────────────────────────────
export function AssetsScreen() {
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setError(null);
    try {
      // year パラメータなし → 全年分一括取得（Web と同じ）
      const data = await fetchAssets();
      setAccounts(data.accounts);
      setYears(data.years);
      if (data.years.length > 0) {
        setSelectedYear((prev) => prev ?? data.years[data.years.length - 1]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
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

  const year = selectedYear ?? years.at(-1) ?? new Date().getFullYear();
  const topAssets = accounts.filter((a) => a.category === "ASSET" && a.parentId === null);
  const topLiabs = accounts.filter((a) => a.category === "LIABILITY" && a.parentId === null);
  const totalAsset = leafOf(accounts, "ASSET").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const totalLiab = leafOf(accounts, "LIABILITY").reduce((s, a) => s + latestBalance(a.balances, year), 0);
  const netWorth = totalAsset - totalLiab;
  const trend = buildTrend(accounts, years);

  const childrenOf = (parentId: number) => accounts.filter((a) => a.parentId === parentId);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={s.title}>資産管理</Text>

      {loading ? (
        <LoadingView />
      ) : error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : accounts.length === 0 ? (
        <View style={s.emptyBox}><Text style={s.emptyText}>資産データがありません。</Text></View>
      ) : (
        <>
          {/* 年選択 */}
          {years.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.yearRow}>
              {years.slice(-10).map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[s.yearChip, selectedYear === y && s.yearChipActive]}
                  onPress={() => setSelectedYear(y)}
                >
                  <Text style={[s.yearChipText, selectedYear === y && s.yearChipTextActive]}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* KPI カード */}
          <View style={s.kpiRow}>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>資産合計</Text>
              <Text style={[s.kpiValue, { color: "#10b981" }]}>{yen(totalAsset)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>負債合計</Text>
              <Text style={[s.kpiValue, { color: "#f43f5e" }]}>{yen(totalLiab)}</Text>
            </View>
            <View style={s.kpiCard}>
              <Text style={s.kpiLabel}>純資産</Text>
              <Text style={[s.kpiValue, { color: netWorth >= 0 ? "#6366f1" : "#dc2626" }]}>
                {yen(netWorth)}
              </Text>
            </View>
          </View>

          {/* 純資産推移グラフ */}
          {trend.length >= 2 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>純資産推移（万円）</Text>
              <AssetTrendChart trend={trend} />
              <View style={s.legend}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#10b981" }]} />
                  <Text style={s.legendText}>資産合計</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#f43f5e" }]} />
                  <Text style={s.legendText}>負債合計</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#6366f1" }]} />
                  <Text style={s.legendText}>純資産</Text>
                </View>
              </View>
            </View>
          )}

          {/* 資産の部 */}
          {topAssets.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>資産の部</Text>
              {topAssets.map((a) => (
                <View key={a.id}>
                  <View style={[s.row, s.rowParent]}>
                    <View style={s.rowLeft}>
                      <Text style={s.rowCode}>{a.code}</Text>
                      <Text style={s.rowName}>{a.name}</Text>
                    </View>
                    <Text style={[s.balance, { color: "#059669" }]}>
                      {yen(latestBalance(a.balances, year))}
                    </Text>
                  </View>
                  {childrenOf(a.id).map((c) => (
                    <View key={c.id} style={[s.row, s.rowChild]}>
                      <View style={s.rowLeft}>
                        <Text style={s.rowCode}>{c.code}</Text>
                        <Text style={[s.rowName, { color: "#64748b", fontSize: 13 }]}>{c.name}</Text>
                      </View>
                      <Text style={[s.balance, { fontSize: 13, color: "#374151" }]}>
                        {yen(latestBalance(c.balances, year))}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>資産合計</Text>
                <Text style={[s.totalValue, { color: "#059669" }]}>{yen(totalAsset)}</Text>
              </View>
            </View>
          )}

          {/* 負債の部 */}
          {topLiabs.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>負債の部</Text>
              {topLiabs.map((a) => (
                <View key={a.id}>
                  <View style={[s.row, s.rowParent]}>
                    <View style={s.rowLeft}>
                      <Text style={s.rowCode}>{a.code}</Text>
                      <Text style={s.rowName}>{a.name}</Text>
                    </View>
                    <Text style={[s.balance, { color: "#e11d48" }]}>
                      {yen(latestBalance(a.balances, year))}
                    </Text>
                  </View>
                  {childrenOf(a.id).map((c) => (
                    <View key={c.id} style={[s.row, s.rowChild]}>
                      <View style={s.rowLeft}>
                        <Text style={s.rowCode}>{c.code}</Text>
                        <Text style={[s.rowName, { color: "#64748b", fontSize: 13 }]}>{c.name}</Text>
                      </View>
                      <Text style={[s.balance, { fontSize: 13, color: "#374151" }]}>
                        {yen(latestBalance(c.balances, year))}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>負債合計</Text>
                <Text style={[s.totalValue, { color: "#e11d48" }]}>{yen(totalLiab)}</Text>
              </View>
            </View>
          )}

          {/* 純資産 */}
          <View style={[s.section, { marginBottom: 24 }]}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>純資産</Text>
              <Text style={[s.totalValue, { color: netWorth >= 0 ? "#6366f1" : "#dc2626" }]}>
                {yen(netWorth)}
              </Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: "#0f172a" },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: "#dc2626", fontSize: 13 },
  emptyBox: { padding: 32, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  yearRow: { flexDirection: "row", marginBottom: 14 },
  yearChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 8 },
  yearChipActive: { backgroundColor: "#4f46e5" },
  yearChipText: { fontSize: 13, color: "#64748b" },
  yearChipTextActive: { color: "#fff", fontWeight: "600" },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  kpiCard: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2, alignItems: "center" },
  kpiLabel: { fontSize: 10, color: "#64748b", marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 10 },
  legend: { flexDirection: "row", gap: 14, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: "#6b7280" },
  section: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 11, fontWeight: "700", color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  rowParent: { backgroundColor: "#f8fafc" },
  rowChild: { paddingLeft: 16 },
  rowLeft: {},
  rowCode: { fontSize: 9, color: "#94a3b8", fontFamily: "monospace" },
  rowName: { fontSize: 14, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  balance: { fontSize: 14, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  totalLabel: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  totalValue: { fontSize: 15, fontWeight: "700" },
});
