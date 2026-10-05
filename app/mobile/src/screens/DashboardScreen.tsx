import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  fetchBudgetVariance,
  fetchKpi,
  fetchMonthlyTrend,
  fetchOnboardingSteps,
  hasSwitchedViewMode,
  type AnnualOutlook,
  type BudgetVariance,
  type KpiBudget,
  type KpiData,
  type OnboardingSteps,
  type TrendMonth,
  type ViewMode,
} from "../api";
import { BudgetActualChart } from "../components/BudgetActualChart";
import { CycleStatusRow, type CycleScreen } from "../components/CycleStatusRow";
import { LoadingView } from "../components/LoadingView";
import { MonthlyCategoryChart } from "../components/MonthlyCategoryChart";
import { Lead, TermList } from "../components/ui";
import { DEFAULT_FORECAST_METHOD, FORECAST_METHODS } from "../shared/forecast-methods";
import { DASHBOARD_HELP, kpiTermHelp, textFor } from "../shared/help-texts";
import { KPI_LABELS } from "../shared/mode-labels";
import { computeStepChecklist } from "../shared/step-checklist";
import { useFiscalYear } from "../fiscal-year";

// web 版ダッシュボードと同じ表示範囲（対象月を中心に前後 6 か月）
const TREND_BACK = 6;
const TREND_FORWARD = 6;

const yen = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";
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

// 累計カードの補助表示（web 版 KPI カードと同じ文言）。
// 未入力の月（平均で按分）と残りの月（予測）の内訳を添える
function ytdSub(annual: AnnualOutlook | null): string | undefined {
  if (!annual) return undefined;
  const notes = [
    annual.missingMonths > 0 ? `未入力${annual.missingMonths}か月は平均` : null,
    annual.remainingMonths > 0 ? `残り${annual.remainingMonths}か月は予測` : null,
  ].filter(Boolean);
  return `年間見込み ${yen(annual.projected)}（${notes.length > 0 ? notes.join("・") : "実績確定"}）`;
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

type Props = {
  viewMode: ViewMode;
  /** 予算・実績の画面の確定タブへ移る（状況の 1 行を押したとき） */
  onOpenCycle?: (screen: CycleScreen, month: string) => void;
};

export function DashboardScreen({ viewMode, onOpenCycle }: Props) {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [budget, setBudget] = useState<KpiBudget | null>(null);
  const [annual, setAnnual] = useState<AnnualOutlook | null>(null);
  const [annualProfit, setAnnualProfit] = useState<AnnualOutlook | null>(null);
  // 対象月の予実（「予算と実績」グラフ）
  const [variance, setVariance] = useState<BudgetVariance | null>(null);
  const [method, setMethod] = useState(DEFAULT_FORECAST_METHOD);
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState<string | null>(null); // null はサーバー既定に従う
  const [months, setMonths] = useState<TrendMonth[]>([]);
  const [range, setRange] = useState<"window" | "year">("window");
  // 対象年度は画面上部のサブヘッダーで選ぶ（全画面で共通）
  const year = useFiscalYear();
  const [steps, setSteps] = useState<OnboardingSteps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
    setAnnualProfit(k?.annualProfit ?? null);
    setPeriods(k?.periods ?? []);
    setSteps(stepRes.status === "fulfilled" ? stepRes.value : null);

    const center = k?.kpi?.period ?? null;
    setVariance(
      center
        ? await fetchBudgetVariance(Number(center.slice(0, 4)), Number(center.slice(5, 7))).catch(
            () => null,
          )
        : null,
    );
    const trend = await fetchMonthlyTrend(
      range === "year"
        ? { year, method }
        : { period: center ?? undefined, back: TREND_BACK, forward: TREND_FORWARD, method },
    ).catch(() => null);
    setMonths(trend?.months ?? []);

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
    setRefreshKey((k) => k + 1);
    await load();
    setRefreshing(false);
  }

  // ── 対象月の送り（対象年度の中の月だけ）────────────────────────
  const currentPeriod = kpi?.period ?? null;
  const yearPeriods = periods.filter((p) => p.startsWith(`${year}-`));
  const periodIndex = currentPeriod ? yearPeriods.indexOf(currentPeriod) : -1;
  function movePeriod(delta: number) {
    const next = yearPeriods[periodIndex + delta];
    if (next) setPeriod(next);
  }
  // 表示中の月が対象年度の外なら、その年度でデータのある最新の月（今月以前を優先）へ移す
  useEffect(() => {
    if (!currentPeriod || currentPeriod.startsWith(`${year}-`)) return;
    const inYear = periods.filter((p) => p.startsWith(`${year}-`));
    if (inYear.length === 0) return;
    const now = new Date();
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setPeriod([...inYear].reverse().find((p) => p <= nowKey) ?? inYear[inYear.length - 1]);
  }, [year, periods, currentPeriod]);

  // ── 構成比（実績が未入力の将来月は予測値を含む）───────────────
  const totals = CATEGORIES.map((cat) => ({
    name: cat,
    value: months.reduce((sum, m) => sum + Number(m[cat as keyof TrendMonth] ?? 0), 0),
  })).filter((d) => d.value > 0);
  const totalSum = totals.reduce((sum, d) => sum + d.value, 0);
  const hasForecast = months.some((m) => m.isForecast);

  const klabels = KPI_LABELS[viewMode];
  const termHelp = kpiTermHelp(viewMode);
  const selectedMethod = FORECAST_METHODS.find((m) => m.value === method);
  // 12 月決算以外は「当期」と呼び、期間を添える
  const fiscalYearIsCalendar = !annual || annual.closingMonth === 12;
  const ytdLabel = fiscalYearIsCalendar ? "当年累計 (YTD)" : "当期累計 (YTD)";
  const ytdProgress = annual
    ? `達成率 ${rate(annual.progressRate)}` +
      (fiscalYearIsCalendar
        ? ""
        : `（${periodLabel(annual.startKey)}〜${periodLabel(annual.endKey)}）`)
    : undefined;
  // 利益カード（家計では貯蓄額）の補助表示は、利益率ではなく年間見込み
  const profitSub = ytdSub(annualProfit);
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
          <Lead>{textFor(DASHBOARD_HELP.page, viewMode)}</Lead>

          {/* ステップ進捗（web 版ダッシュボードと同じ 6 ステップ。全達成後は非表示） */}
          {showSteps && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>
                ステップ進捗（{stepDone} / {stepItems.length}）
              </Text>
              <Text style={s.cardNote}>{DASHBOARD_HELP.steps}</Text>
              {stepItems.map((i) => (
                <View key={i.step} style={[s.stepRow, i.done ? s.stepDone : s.stepTodo]}>
                  <Text style={s.stepIcon}>{i.done ? "✅" : "⬜"}</Text>
                  <Text style={[s.stepLabel, i.done && s.stepLabelDone]}>{i.label}</Text>
                </View>
              ))}
            </View>
          )}

          {!kpi || (periods.length > 0 && yearPeriods.length === 0) ? (
            <View style={s.noticeBox}>
              <Text style={s.noticeText}>
                {kpi
                  ? `${year}年にはデータがありません`
                  : "実績が未入力のため KPI は表示できません"}
              </Text>
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
                    (periodIndex < 0 || periodIndex >= yearPeriods.length - 1) && s.navBtnDisabled,
                  ]}
                  disabled={periodIndex < 0 || periodIndex >= yearPeriods.length - 1}
                  onPress={() => movePeriod(1)}
                >
                  <Text style={s.navBtnTxt}>›</Text>
                </TouchableOpacity>
              </View>

              <Lead>{textFor(DASHBOARD_HELP.kpi, viewMode)}</Lead>

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
                      sub={profitSub}
                      budget={budgetSub(
                        budget?.operatingProfit,
                        budget?.operatingProfitRate ?? null,
                        "達成率",
                      )}
                    />
                    <KpiCard
                      label={ytdLabel}
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
                      sub={profitSub}
                      budget={budgetSub(
                        budget?.operatingProfit,
                        budget?.operatingProfitRate ?? null,
                        "達成率",
                      )}
                    />
                    <KpiCard
                      label={ytdLabel}
                      value={yen(kpi.ytd)}
                      sub={ytdSub(annual)}
                      budget={ytdProgress}
                    />
                  </View>
                </>
              )}

              <TermList
                label="累計・年間見込みの説明"
                terms={[
                  { term: ytdLabel, text: termHelp.ytd },
                  { term: `${klabels.profit}の年間見込み`, text: termHelp.profit },
                ]}
              />
            </>
          )}
        </>
      )}

      {/* 予算と実績の確定の状況（前月）。確定の操作は予算・実績の画面で行う */}
      {!loading && !error && <CycleStatusRow refreshKey={refreshKey} onOpen={onOpenCycle} />}

      {/* 予算と実績（KPI の対象月の差をひと目で） */}
      {!loading && !error && kpi && (
        <BudgetActualChart viewMode={viewMode} period={kpi.period} data={variance} />
      )}

      {!loading && !error && (kpi || months.length > 0) && (
        <>
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

          {range === "year" && <Text style={s.selectorLabel}>{year}年（1〜12 月）</Text>}

          {/* 予測手法（実績が未入力の月をどの計算方法で見積もるか。web 版と同じ 5 手法） */}
          <View style={s.methodHeader}>
            <Text style={s.selectorLabel}>予測手法</Text>
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
          {/* 選んでいる手法の説明を常に出す（web 版と同じ） */}
          <Text style={s.methodHelp}>
            {DASHBOARD_HELP.forecast}
            {selectedMethod && (
              <>
                {" "}
                <Text style={s.methodHelpStrong}>{selectedMethod.label}</Text>：
                {selectedMethod.help}
              </>
            )}
          </Text>

          {/* カテゴリ構成比 */}
          {totals.length > 0 && (
            <View style={[s.card, s.cardGap]}>
              <Text style={s.cardTitle}>カテゴリ構成比</Text>
              <Text style={s.cardNote}>
                {textFor(DASHBOARD_HELP.composition, viewMode)}
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
                {textFor(DASHBOARD_HELP.monthly, viewMode)}
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
  cardNote: { fontSize: 11, color: "#64748b", lineHeight: 16, marginBottom: 10 },

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
  methodHelp: { fontSize: 11, color: "#64748b", lineHeight: 16, marginBottom: 12 },
  methodHelpStrong: { fontWeight: "700", color: "#475569" },

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
});
