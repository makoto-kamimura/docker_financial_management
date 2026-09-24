// 決算（web 版 /closing と同じ KPI・5 タブを閲覧のみで出す。決算確定・申告書類・e-Tax XML は web 版）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchClosing,
  type ClosingAccountRow,
  type ClosingStatements,
  type ViewMode,
} from "../api";
import { Card, Notice, Pills, SectionTitle, TabBar } from "../components/ui";
import { MONTHS, yen } from "../format";
import { displayName } from "../shared/display-name";

type Tab = "pnl" | "bs" | "monthly" | "trial" | "ratios";
const TABS = [
  ["pnl", "損益計算書"],
  ["bs", "貸借対照表"],
  ["monthly", "月別収支"],
  ["trial", "試算表"],
  ["ratios", "財務分析"],
] as const;

// 試算表の種別名（web 版 決算の CATEGORY_LABELS と同じ。申告書の用語に合わせている）
const CATEGORY_LABELS: Record<string, string> = {
  REVENUE: "収入",
  COGS: "売上原価",
  EXPENSE: "経費",
  ASSET: "資産",
  LIABILITY: "負債",
  PROFIT: "損益",
  OTHER: "その他",
};

function AccountLines({
  rows,
  viewMode,
  color,
  amountOf = (a) => a.total,
}: {
  rows: ClosingAccountRow[];
  viewMode: ViewMode;
  color: string;
  amountOf?: (a: ClosingAccountRow) => number;
}) {
  return (
    <>
      {rows.map((a) => (
        <View key={a.accountId} style={s.line}>
          <Text style={s.code}>{a.code}</Text>
          <Text style={s.lineName} numberOfLines={1}>
            {displayName(a, viewMode)}
            {a.businessRate !== undefined && a.businessRate < 100
              ? `（按分 ${a.businessRate}%）`
              : ""}
          </Text>
          <Text style={[s.lineAmount, { color }]}>{yen(amountOf(a))}</Text>
        </View>
      ))}
    </>
  );
}

function TotalLine({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[s.line, s.totalLine]}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={[s.totalValue, { color }]}>{yen(value)}</Text>
    </View>
  );
}

function Metric({
  label,
  value,
  unit,
  description,
  good,
}: {
  label: string;
  value: number | null;
  unit: string;
  description: string;
  good: (v: number) => boolean;
}) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      {value === null ? (
        <Text style={s.muted}>計算不可</Text>
      ) : (
        <Text style={[s.metricValue, { color: good(value) ? "#4338ca" : "#dc2626" }]}>
          {value.toLocaleString()} <Text style={s.metricUnit}>{unit}</Text>
        </Text>
      )}
      <Text style={s.muted}>{description}</Text>
    </View>
  );
}

type Props = { viewMode: ViewMode };

export function ClosingScreen({ viewMode }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("pnl");
  const [data, setData] = useState<ClosingStatements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchClosing(year));
    } catch (e) {
      setError(e instanceof Error ? e.message : "データを取得できませんでした");
    }
  }, [year]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const pnl = data?.pnl;
  const bs = data?.bs;
  const monthlyTotals = MONTHS.reduce(
    (acc, m) => ({
      revenue: acc.revenue + (data?.monthly[m]?.revenue ?? 0),
      cogs: acc.cogs + (data?.monthly[m]?.cogs ?? 0),
      expense: acc.expense + (data?.monthly[m]?.expense ?? 0),
    }),
    { revenue: 0, cogs: 0, expense: 0 },
  );

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Notice>
        決算確定・申告書類の印刷・e-Tax XML の出力は Web
        版から行ってください（モバイルでは閲覧のみ）。
      </Notice>
      <Pills
        options={[
          currentYear + 1,
          currentYear,
          currentYear - 1,
          currentYear - 2,
          currentYear - 3,
        ].map((y) => ({
          value: y,
          label: `${y}年`,
        }))}
        value={year}
        onChange={setYear}
      />
      {error && <Notice tone="error">{error}</Notice>}

      {!data || !pnl || !bs ? (
        !error && <ActivityIndicator color="#4f46e5" style={{ marginTop: 32 }} />
      ) : (
        <>
          <Text style={[s.status, data.closeStatus?.status === "closed" ? s.closed : s.open]}>
            {data.closeStatus?.status === "closed" ? "✓ 決算確定済" : "未確定"}
          </Text>
          <View style={s.kpis}>
            {(
              [
                ["収入合計", pnl.revenueTotal, "#047857"],
                ["経費合計（按分後）", pnl.expenseDeductible, "#dc2626"],
                ["事業所得", pnl.netIncome, pnl.netIncome >= 0 ? "#4338ca" : "#dc2626"],
                ["純資産", bs.equity, "#1e293b"],
              ] as [string, number, string][]
            ).map(([label, value, color]) => (
              <Card key={label} style={s.kpi}>
                <Text style={s.kpiLabel}>{label}</Text>
                <Text style={[s.kpiValue, { color }]}>{yen(value)}</Text>
              </Card>
            ))}
          </View>

          <TabBar tabs={TABS} value={tab} onChange={setTab} />
          <Card style={{ marginTop: 8 }}>
            {tab === "pnl" && (
              <>
                <SectionTitle>収入金額</SectionTitle>
                <AccountLines rows={pnl.revenue} viewMode={viewMode} color="#047857" />
                <TotalLine label="収入合計" value={pnl.revenueTotal} color="#047857" />
                {pnl.cogs.length > 0 && (
                  <>
                    <SectionTitle>売上原価</SectionTitle>
                    <AccountLines rows={pnl.cogs} viewMode={viewMode} color="#dc2626" />
                    <TotalLine label="原価合計" value={pnl.cogsTotal} color="#dc2626" />
                  </>
                )}
                <View style={s.highlight}>
                  <Text style={s.highlightLabel}>売上総利益</Text>
                  <Text style={s.highlightValue}>{yen(pnl.grossProfit)}</Text>
                </View>
                <SectionTitle>
                  経費{pnl.expenseTotal !== pnl.expenseDeductible ? "（家事按分後）" : ""}
                </SectionTitle>
                <AccountLines
                  rows={pnl.expenses}
                  viewMode={viewMode}
                  color="#dc2626"
                  amountOf={(a) => a.deductible ?? a.total}
                />
                <TotalLine
                  label="経費合計（必要経費）"
                  value={pnl.expenseDeductible}
                  color="#dc2626"
                />
                <View style={[s.highlight, pnl.netIncome >= 0 ? s.income : s.loss]}>
                  <View>
                    <Text style={s.highlightLabel}>事業所得（課税所得）</Text>
                    <Text style={s.muted}>収入 − 原価 − 必要経費（家事按分後）</Text>
                  </View>
                  <Text
                    style={[
                      s.highlightValue,
                      { color: pnl.netIncome >= 0 ? "#047857" : "#dc2626" },
                    ]}
                  >
                    {yen(pnl.netIncome)}
                  </Text>
                </View>
              </>
            )}

            {tab === "bs" && (
              <>
                <SectionTitle>資産の部</SectionTitle>
                <AccountLines rows={bs.assets} viewMode={viewMode} color="#047857" />
                <TotalLine label="資産合計" value={bs.assetTotal} color="#047857" />
                <SectionTitle>負債の部</SectionTitle>
                <AccountLines rows={bs.liabilities} viewMode={viewMode} color="#dc2626" />
                <TotalLine label="負債合計" value={bs.liabilityTotal} color="#dc2626" />
                <TotalLine
                  label="純資産（資産−負債）"
                  value={bs.equity}
                  color={bs.equity >= 0 ? "#4338ca" : "#dc2626"}
                />
              </>
            )}

            {tab === "monthly" && (
              <>
                {MONTHS.map((m) => {
                  const d = data.monthly[m] ?? { revenue: 0, cogs: 0, expense: 0 };
                  const profit = d.revenue - d.cogs - d.expense;
                  return (
                    <View key={m} style={s.monthRow}>
                      <Text style={s.monthLabel}>
                        {data.fiscalYear}年{m}月
                      </Text>
                      <Text style={s.muted}>
                        収入 {d.revenue > 0 ? yen(d.revenue) : "—"} ・ 原価{" "}
                        {d.cogs > 0 ? yen(d.cogs) : "—"} ・ 経費{" "}
                        {d.expense > 0 ? yen(d.expense) : "—"}
                      </Text>
                      <Text style={[s.monthProfit, { color: profit >= 0 ? "#1e293b" : "#dc2626" }]}>
                        差引利益 {yen(profit)}
                      </Text>
                    </View>
                  );
                })}
                <TotalLine
                  label="年間合計（差引利益）"
                  value={monthlyTotals.revenue - monthlyTotals.cogs - monthlyTotals.expense}
                  color={
                    monthlyTotals.revenue - monthlyTotals.cogs - monthlyTotals.expense >= 0
                      ? "#4338ca"
                      : "#dc2626"
                  }
                />
                <Text style={s.muted}>
                  収入 {yen(monthlyTotals.revenue)} ・ 原価 {yen(monthlyTotals.cogs)} ・ 経費{" "}
                  {yen(monthlyTotals.expense)}
                </Text>
              </>
            )}

            {tab === "trial" &&
              data.trialBalance.map((a) => (
                <View key={a.accountId} style={s.line}>
                  <Text style={s.code}>{a.code}</Text>
                  <Text style={s.lineName} numberOfLines={1}>
                    {displayName(a, viewMode)}
                    <Text style={s.muted}>　{CATEGORY_LABELS[a.category] ?? a.category}</Text>
                  </Text>
                  <Text
                    style={[
                      s.lineAmount,
                      {
                        color: ["ASSET", "EXPENSE", "COGS"].includes(a.category)
                          ? "#1e293b"
                          : "#047857",
                      },
                    ]}
                  >
                    {yen(a.total)}
                  </Text>
                </View>
              ))}

            {tab === "ratios" && (
              <>
                <SectionTitle>安全性指標</SectionTitle>
                <Metric
                  label="流動比率"
                  value={data.ratios.currentRatio}
                  unit="倍"
                  description="流動資産 ÷ 流動負債。200%（2倍）以上が理想。"
                  good={(v) => v >= 2}
                />
                <Metric
                  label="自己資本比率"
                  value={data.ratios.equityRatio}
                  unit="%"
                  description="純資産 ÷ 総資産。40%以上が優良。"
                  good={(v) => v >= 40}
                />
                <SectionTitle>収益性指標</SectionTitle>
                <Metric
                  label="ROA（総資産利益率）"
                  value={data.ratios.roa}
                  unit="%"
                  description="当期純利益 ÷ 総資産。5%以上が目安。"
                  good={(v) => v >= 5}
                />
                <Metric
                  label="ROE（自己資本利益率）"
                  value={data.ratios.roe}
                  unit="%"
                  description="当期純利益 ÷ 純資産。10%以上が目安。"
                  good={(v) => v >= 10}
                />
                <Metric
                  label="売上総利益率"
                  value={data.ratios.grossProfitRate}
                  unit="%"
                  description="売上総利益 ÷ 売上高。業種により異なる。"
                  good={(v) => v >= 20}
                />
                <Metric
                  label="営業利益率（純利益率）"
                  value={data.ratios.operatingMargin}
                  unit="%"
                  description="当期純利益 ÷ 売上高。5%以上が目安。"
                  good={(v) => v >= 5}
                />
                <SectionTitle>計算の元データ</SectionTitle>
                <Text style={s.muted}>
                  総資産 {yen(bs.assetTotal)} ・ 総負債 {yen(bs.liabilityTotal)} ・ 純資産{" "}
                  {yen(bs.equity)}
                </Text>
                <Text style={s.muted}>
                  売上高 {yen(pnl.revenueTotal)} ・ 売上総利益 {yen(pnl.grossProfit)} ・ 当期純利益{" "}
                  {yen(pnl.netIncome)}
                </Text>
              </>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, paddingBottom: 32 },
  status: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
    marginVertical: 8,
  },
  closed: { backgroundColor: "#d1fae5", color: "#047857" },
  open: { backgroundColor: "#f1f5f9", color: "#64748b" },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { width: "48%", padding: 10 },
  kpiLabel: { fontSize: 11, color: "#64748b" },
  kpiValue: { fontSize: 15, fontWeight: "700", marginTop: 2 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  code: { fontSize: 10, color: "#94a3b8", width: 52 },
  lineName: { flex: 1, fontSize: 12, color: "#334155" },
  lineAmount: { fontSize: 12, fontWeight: "600" },
  totalLine: { borderTopWidth: 1, borderTopColor: "#e2e8f0", marginBottom: 10 },
  totalLabel: { flex: 1, fontSize: 13, fontWeight: "700", color: "#1e293b" },
  totalValue: { fontSize: 14, fontWeight: "700" },
  highlight: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#eef2ff",
    borderRadius: 8,
    padding: 10,
    marginVertical: 10,
  },
  income: { backgroundColor: "#ecfdf5" },
  loss: { backgroundColor: "#fef2f2" },
  highlightLabel: { fontSize: 13, fontWeight: "700", color: "#3730a3" },
  highlightValue: { fontSize: 16, fontWeight: "700", color: "#4338ca" },
  monthRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  monthLabel: { fontSize: 12, fontWeight: "600", color: "#334155" },
  monthProfit: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  metric: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  metricLabel: { fontSize: 11, color: "#64748b" },
  metricValue: { fontSize: 20, fontWeight: "700", marginTop: 2 },
  metricUnit: { fontSize: 12, color: "#64748b", fontWeight: "400" },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16 },
});
