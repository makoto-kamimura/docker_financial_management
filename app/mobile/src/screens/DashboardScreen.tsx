import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  fetchKpi,
  fetchMonthlyTrend,
  fetchOnboardingSteps,
  hasSwitchedViewMode,
  type AnnualOutlook,
  type KpiBudget,
  type KpiData,
  type OnboardingSteps,
  type TrendMonth,
  type ViewMode,
} from "../api";
import { LoadingView } from "../components/LoadingView";
import { MonthlyCategoryChart } from "../components/MonthlyCategoryChart";
import { DEFAULT_FORECAST_METHOD, FORECAST_METHODS } from "../shared/forecast-methods";
import { KPI_LABELS } from "../shared/mode-labels";
import { computeStepChecklist } from "../shared/step-checklist";

// web 版ダッシュボードと同じ表示範囲（対象月を中心に前後 6 か月）
const TREND_BACK = 6;
const TREND_FORWARD = 6;

const yen = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";
const pct = (v: number | null) =>
  v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
// 達成率・消化率は増減ではないので符号を付けない
const rate = (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
const periodLabel = (key: string) => `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
const monthLabel = (key: string) => `${Number(key.slice(5, 7))}月`;

// 予算が未登録の月は「予算 未設定」を出して欠落と 0 円を区別する（web 版と同じ文言）
const budgetSub = (amount: number | undefined, r: number | null, rateLabel: string) =>
  amount == null ? "予算 未設定" : `予算 ${yen(amount)}（${rateLabel} ${rate(r)}）`;

const CAT_LABEL: Record<string, string> = {
  REVENUE: "収入",
  COGS: "変動費",
  EXPENSE: "固定費",
  PROFIT: "貯蓄/利益",
  OTHER: "税金等",
};
const CAT_COLORS: Record<string, string> = {
  REVENUE: "#6366f1",
  COGS: "#f97316",
  EXPENSE: "#f59e0b",
  PROFIT: "#10b981",
  OTHER: "#94a3b8",
};
const CATEGORIES = Object.keys(CAT_LABEL);

// 当年累計カードの補助表示（web 版 KPI カードと同じ文言）
function ytdSub(annual: AnnualOutlook | null): string | undefined {
  if (!annual) return undefined;
  return annual.remainingMonths > 0
    ? `年間見込み ${yen(annual.projected)}（残り${annual.remainingMonths}か月は予測）`
    : `年間見込み ${yen(annual.projected)}（実績確定）`;
}

function KpiCard({
  label,
  value,
  sub,
  budget,
  color,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  budget?: string;
  color?: string;
  warn?: boolean;
}) {
  return (
    <View style={[s.kpiCard, warn && s.kpiCardWarn]}>
      <Text style={[s.kpiLabel, warn && s.kpiLabelWarn]}>
        {warn ? "⚠ " : ""}
        {label}
      </Text>
      <Text style={[s.kpiValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
      {budget ? <Text style={s.kpiBudget}>{budget}</Text> : null}
    </View>
  );
}

type Props = { viewMode: ViewMode };

export function DashboardScreen({ viewMode }: Props) {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [budget, setBudget] = useState<KpiBudget | null>(null);
  const [annual, setAnnual] = useState<AnnualOutlook | null>(null);
  const [method, setMethod] = useState(DEFAULT_FORECAST_METHOD);
  const [showMethodHelp, setShowMethodHelp] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState<string | null>(null); // null はサーバー既定に従う
  const [months, setMonths] = useState<TrendMonth[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [range, setRange] = useState<"window" | "year">("window");
  const [year, setYear] = useState<number | null>(null);
  const [steps, setSteps] = useState<OnboardingSteps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    // KPI・ステップ進捗・推移は独立に取得し、片方の失敗・未入力で画面全体を落とさない
    const [kpiRes, stepRes] = await Promise.allSettled([
      fetchKpi(period ?? undefined),
      fetchOnboardingSteps(),
    ]);

    const k = kpiRes.status === "fulfilled" ? kpiRes.value : null;
    setKpi(k?.kpi ?? null);
    setBudget(k?.budget ?? null);
    setAnnual(k?.annual ?? null);
    setPeriods(k?.periods ?? []);
    setSteps(stepRes.status === "fulfilled" ? stepRes.value : null);

    const center = k?.kpi?.period ?? null;
    // 年度モードの既定は対象月の年（実績が無ければ今年）
    const targetYear = year ?? (Number((center ?? "").slice(0, 4)) || new Date().getFullYear());
    const trend = await fetchMonthlyTrend(
      range === "year"
        ? { year: targetYear, method }
        : { period: center ?? undefined, back: TREND_BACK, forward: TREND_FORWARD, method },
    ).catch(() => null);
    setMonths(trend?.months ?? []);
    setYears(trend?.years ?? []);

    if (kpiRes.status === "rejected" && trend === null) {
      setError("データの取得に失敗しました");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [viewMode, period, range, year, method]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // ── 対象月・年度の送り ─────────────────────────────────────
  const currentPeriod = kpi?.period ?? null;
  const periodIndex = currentPeriod ? periods.indexOf(currentPeriod) : -1;
  function movePeriod(delta: number) {
    const next = periods[periodIndex + delta];
    if (next) setPeriod(next);
  }
  const displayYear =
    year ?? (Number((currentPeriod ?? "").slice(0, 4)) || new Date().getFullYear());
  const yearIndex = years.indexOf(displayYear);
  function moveYear(delta: number) {
    const next = years[yearIndex + delta];
    if (next) setYear(next);
  }

  // ── 構成比（実績が未入力の将来月は予測値を含む）───────────────
  const totals = CATEGORIES.map((cat) => ({
    name: cat,
    value: months.reduce((sum, m) => sum + Number(m[cat as keyof TrendMonth] ?? 0), 0),
  })).filter((d) => d.value > 0);
  const totalSum = totals.reduce((sum, d) => sum + d.value, 0);
  const hasForecast = months.some((m) => m.isForecast);

  const klabels = KPI_LABELS[viewMode];
  const ytdProgress = annual ? `達成率 ${rate(annual.progressRate)}` : undefined;
  const stepItems = steps
    ? computeStepChecklist({ ...steps, hasSwitchedMode: hasSwitchedViewMode() })
    : [];
  const stepDone = stepItems.filter((i) => i.done).length;
  const showSteps = stepItems.length > 0 && stepDone < stepItems.length;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {loading ? (
        <LoadingView />
      ) : error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : !kpi && months.length === 0 ? (
        <View style={s.noticeBox}>
          <Text style={s.noticeText}>予算・実績データが未登録です</Text>
        </View>
      ) : (
        <>
          {/* ステップ進捗（web 版ダッシュボードと同じ 6 ステップ。全達成後は非表示） */}
          {showSteps && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>
                ステップ進捗（{stepDone} / {stepItems.length}）
              </Text>
              {stepItems.map((i) => (
                <View key={i.step} style={[s.stepRow, i.done ? s.stepDone : s.stepTodo]}>
                  <Text style={s.stepIcon}>{i.done ? "✅" : "⬜"}</Text>
                  <Text style={[s.stepLabel, i.done && s.stepLabelDone]}>{i.label}</Text>
                </View>
              ))}
            </View>
          )}

          {!kpi ? (
            <View style={s.noticeBox}>
              <Text style={s.noticeText}>実績が未入力のため KPI は表示できません</Text>
            </View>
          ) : (
            <>
              {/* 対象月セレクタ（web 版 KPI カードの「対象月」と同じ操作） */}
              <View style={s.selectorRow}>
                <Text style={s.selectorLabel}>対象月</Text>
                <TouchableOpacity
                  style={[s.navBtn, periodIndex <= 0 && s.navBtnDisabled]}
                  disabled={periodIndex <= 0}
                  onPress={() => movePeriod(-1)}
                >
                  <Text style={s.navBtnTxt}>‹</Text>
                </TouchableOpacity>
                <Text style={s.selectorValue}>{periodLabel(kpi.period)}</Text>
                <TouchableOpacity
                  style={[
                    s.navBtn,
                    (periodIndex < 0 || periodIndex >= periods.length - 1) && s.navBtnDisabled,
                  ]}
                  disabled={periodIndex < 0 || periodIndex >= periods.length - 1}
                  onPress={() => movePeriod(1)}
                >
                  <Text style={s.navBtnTxt}>›</Text>
                </TouchableOpacity>
              </View>

              {viewMode === "household" && kpi.operatingProfit < 0 && (
                <Text style={s.deficitText}>
                  ⚠ {periodLabel(kpi.period)}は支出が収入を上回っています
                </Text>
              )}

              {/* KPI カード */}
              {viewMode === "household" ? (
                <>
                  <View style={s.kpiRow}>
                    <KpiCard
                      label={klabels.revenue}
                      value={yen(kpi.revenue)}
                      budget={budgetSub(budget?.revenue, budget?.revenueRate ?? null, "達成率")}
                    />
                    <KpiCard
                      label="支出"
                      value={yen(kpi.revenue - kpi.operatingProfit)}
                      color="#dc2626"
                      budget={budgetSub(
                        budget ? budget.cogs + budget.expense : undefined,
                        budget?.expenseRate ?? null,
                        "消化率",
                      )}
                    />
                  </View>
                  <View style={s.kpiRow}>
                    <KpiCard
                      label={klabels.profit}
                      value={yen(kpi.operatingProfit)}
                      color={kpi.operatingProfit >= 0 ? "#16a34a" : "#dc2626"}
                      warn={kpi.operatingProfit < 0}
                      sub={`${klabels.profitRate} ${rate(kpi.operatingMargin)}`}
                      budget={budgetSub(
                        budget?.operatingProfit,
                        budget?.operatingProfitRate ?? null,
                        "達成率",
                      )}
                    />
                    <KpiCard
                      label="当年累計 (YTD)"
                      value={yen(kpi.ytd)}
                      sub={ytdSub(annual)}
                      budget={ytdProgress}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={s.kpiRow}>
                    <KpiCard
                      label={klabels.revenue}
                      value={yen(kpi.revenue)}
                      budget={budgetSub(budget?.revenue, budget?.revenueRate ?? null, "達成率")}
                    />
                    <KpiCard
                      label={klabels.grossProfit}
                      value={yen(kpi.grossProfit)}
                      sub={`${klabels.grossMargin} ${rate(kpi.grossMargin)}`}
                      color={kpi.grossProfit >= 0 ? "#16a34a" : "#dc2626"}
                      budget={budget ? `予算 ${yen(budget.grossProfit)}` : "予算 未設定"}
                    />
                  </View>
                  <View style={s.kpiRow}>
                    <KpiCard
                      label={klabels.profit}
                      value={yen(kpi.operatingProfit)}
                      color={kpi.operatingProfit >= 0 ? "#16a34a" : "#dc2626"}
                      sub={`${klabels.profitRate} ${rate(kpi.operatingMargin)}`}
                      budget={budgetSub(
                        budget?.operatingProfit,
                        budget?.operatingProfitRate ?? null,
                        "達成率",
                      )}
                    />
                    <KpiCard
                      label="当年累計 (YTD)"
                      value={yen(kpi.ytd)}
                      sub={ytdSub(annual)}
                      budget={ytdProgress}
                    />
                  </View>
                </>
              )}

              <View style={s.kpiRow}>
                <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} />
                <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} />
              </View>
            </>
          )}

          {/* 表示範囲の切替（web 版の「対象月±6か月 / 年度」と同じ） */}
          <View style={s.toggleRow}>
            {(["window", "year"] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[s.toggleBtn, range === r && s.toggleActive]}
                onPress={() => setRange(r)}
              >
                <Text style={[s.toggleText, range === r && s.toggleActiveText]}>
                  {r === "window" ? `対象月±${TREND_BACK}か月` : "年度"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {range === "year" && (
            <View style={s.selectorRow}>
              <Text style={s.selectorLabel}>年度</Text>
              <TouchableOpacity
                style={[s.navBtn, yearIndex <= 0 && s.navBtnDisabled]}
                disabled={yearIndex <= 0}
                onPress={() => moveYear(-1)}
              >
                <Text style={s.navBtnTxt}>‹</Text>
              </TouchableOpacity>
              <Text style={s.selectorValue}>{displayYear}年度</Text>
              <TouchableOpacity
                style={[
                  s.navBtn,
                  (yearIndex < 0 || yearIndex >= years.length - 1) && s.navBtnDisabled,
                ]}
                disabled={yearIndex < 0 || yearIndex >= years.length - 1}
                onPress={() => moveYear(1)}
              >
                <Text style={s.navBtnTxt}>›</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 予測手法（実績が未入力の月をどの計算方法で見積もるか。web 版と同じ 5 手法） */}
          <View style={s.methodHeader}>
            <Text style={s.selectorLabel}>予測手法</Text>
            <TouchableOpacity onPress={() => setShowMethodHelp((v) => !v)} hitSlop={8}>
              <Text style={s.helpIcon}>?</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.methodRow}
          >
            {FORECAST_METHODS.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[s.methodPill, method === m.value && s.methodPillActive]}
                onPress={() => setMethod(m.value)}
              >
                <Text style={[s.methodPillText, method === m.value && s.methodPillTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {showMethodHelp && (
            <View style={s.helpBox}>
              <Text style={s.helpText}>
                実績が未入力の月を、どの計算方法で見積もるかを選びます。
              </Text>
              {FORECAST_METHODS.map((m) => (
                <Text key={m.value} style={s.helpText}>
                  <Text style={s.helpTextStrong}>{m.label}</Text>：{m.help}
                </Text>
              ))}
            </View>
          )}

          {/* カテゴリ構成比 */}
          {totals.length > 0 && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>カテゴリ構成比</Text>
              <Text style={s.cardNote}>
                {hasForecast
                  ? "実績が未入力の月は予測値を含めて集計しています。"
                  : "表示範囲の実績を集計しています。"}
              </Text>
              {totals.map((d) => (
                <View key={d.name} style={s.compRow}>
                  <Text style={s.compLabel}>{CAT_LABEL[d.name] ?? d.name}</Text>
                  <View style={s.compBarTrack}>
                    <View
                      style={[
                        s.compBarFill,
                        {
                          width: `${totalSum > 0 ? (d.value / totalSum) * 100 : 0}%`,
                          backgroundColor: CAT_COLORS[d.name] ?? "#cbd5e1",
                        },
                      ]}
                    />
                  </View>
                  <Text style={s.compValue}>
                    {totalSum > 0 ? `${((d.value / totalSum) * 100).toFixed(1)}%` : "—"}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* 月別カテゴリ内訳（web 版と同じ積み上げ棒。予測月は薄い色） */}
          {months.length > 0 && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>月別カテゴリ内訳（万円）</Text>
              <Text style={s.cardNote}>
                薄い色の月は予測値です（実績が未入力の月を予測で補完しています）。
              </Text>
              <MonthlyCategoryChart
                months={months}
                categories={CATEGORIES}
                colors={CAT_COLORS}
                labels={CAT_LABEL}
                monthLabel={monthLabel}
              />
            </View>
          )}

          {/* 月次収支サマリー */}
          {months.length > 0 && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>
                月次収支サマリー（
                {range === "year" ? `${displayYear}年度` : `対象月±${TREND_BACK}か月`}）
              </Text>
              <Text style={s.cardNote}>
                支出が収入を上回った月は赤字表示です。「予測」は実績が未入力の月の推測値です。
              </Text>
              <View style={s.tableHead}>
                <Text style={[s.thCell, s.colMonth]}>月</Text>
                <Text style={[s.thCell, s.colNum]}>収入</Text>
                <Text style={[s.thCell, s.colNum]}>支出</Text>
                <Text style={[s.thCell, s.colNum]}>差引</Text>
              </View>
              {months.map((m) => {
                const revenue = Number(m.REVENUE ?? 0);
                const expense = Number(m.COGS ?? 0) + Number(m.EXPENSE ?? 0);
                const net = revenue - expense;
                const isDeficit = expense > revenue;
                return (
                  <View key={m.key} style={[s.tableRow, isDeficit && s.tableRowDeficit]}>
                    <Text style={[s.tdCell, s.colMonth, isDeficit && s.tdDeficit]}>
                      {isDeficit ? "⚠ " : ""}
                      {range === "year" ? monthLabel(m.key) : periodLabel(m.key)}
                      {m.isForecast ? " (予測)" : ""}
                    </Text>
                    <Text style={[s.tdCell, s.colNum]}>{yen(revenue)}</Text>
                    <Text style={[s.tdCell, s.colNum]}>{yen(expense)}</Text>
                    <Text style={[s.tdCell, s.colNum, net < 0 ? s.netMinus : s.netPlus]}>
                      {yen(net)}
                    </Text>
                  </View>
                );
              })}
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
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: { color: "#dc2626", fontSize: 13 },
  noticeBox: {
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 10,
  },
  noticeText: { color: "#64748b", fontSize: 13 },

  selectorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  selectorLabel: { fontSize: 11, color: "#64748b" },
  selectorValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
    minWidth: 90,
    textAlign: "center",
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnDisabled: { opacity: 0.4 },
  navBtnTxt: { fontSize: 16, color: "#475569", lineHeight: 18 },
  deficitText: { fontSize: 12, color: "#dc2626", fontWeight: "600", marginBottom: 8 },

  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  kpiCardWarn: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  kpiLabel: { fontSize: 11, color: "#64748b", marginBottom: 4 },
  kpiLabelWarn: { color: "#dc2626" },
  kpiValue: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  kpiSub: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  kpiBudget: {
    fontSize: 10,
    color: "#4f46e5",
    marginTop: 6,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },

  toggleRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    padding: 3,
    marginVertical: 12,
    alignSelf: "flex-start",
  },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  toggleActive: { backgroundColor: "#fff" },
  toggleText: { fontSize: 12, color: "#64748b" },
  toggleActiveText: { color: "#1e293b", fontWeight: "600" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardGap: { marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  cardNote: { fontSize: 10, color: "#94a3b8", marginBottom: 10 },

  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  stepDone: { backgroundColor: "#f0fdf4" },
  stepTodo: { backgroundColor: "#f8fafc" },
  stepIcon: { fontSize: 12 },
  stepLabel: { fontSize: 11, color: "#64748b", flex: 1 },
  stepLabelDone: { color: "#15803d" },

  methodHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  helpIcon: {
    fontSize: 10,
    color: "#64748b",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    width: 16,
    height: 16,
    textAlign: "center",
    lineHeight: 14,
  },
  methodRow: { gap: 6, paddingBottom: 10 },
  methodPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
  },
  methodPillActive: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  methodPillText: { fontSize: 11, color: "#475569" },
  methodPillTextActive: { color: "#fff", fontWeight: "600" },
  helpBox: { backgroundColor: "#1e293b", borderRadius: 8, padding: 10, marginBottom: 12, gap: 4 },
  helpText: { fontSize: 10, color: "#fff", lineHeight: 15 },
  helpTextStrong: { fontWeight: "700" },

  compRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  compLabel: { fontSize: 11, color: "#475569", width: 62 },
  compBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#f1f5f9",
    overflow: "hidden",
  },
  compBarFill: { height: 10, borderRadius: 5 },
  compValue: { fontSize: 11, color: "#0f172a", width: 52, textAlign: "right" },

  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 6,
    marginBottom: 4,
  },
  thCell: { fontSize: 10, color: "#64748b", fontWeight: "600" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  tableRowDeficit: { backgroundColor: "#fef2f2" },
  tdCell: { fontSize: 11, color: "#334155" },
  tdDeficit: { color: "#b91c1c", fontWeight: "600" },
  colMonth: { flex: 1.4 },
  colNum: { flex: 1, textAlign: "right" },
  netMinus: { color: "#dc2626", fontWeight: "600" },
  netPlus: { color: "#16a34a", fontWeight: "600" },
});
