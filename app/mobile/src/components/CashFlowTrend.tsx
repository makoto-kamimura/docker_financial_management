// 銀行管理キャッシュフロータブの「残高の推移」（web 版 components/CashFlowTrendCharts.tsx と同じ）。
// 日付つきの総残高と合計のグラフ、口座ごとの小さなグラフ。今月より先は破線。
// 合計の先は予算と実績の収支から、口座ごとの先は毎月の入出金から見込む（GET /bank-accounts/cash-outlook）。
// 「表示する銀行」で 1 口座を選んだときは、その口座の残高と線グラフだけを出す（見込みは毎月の入出金から）。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchCashOutlook, type CashOutlook } from "../api";
import { yen } from "../format";
import { asOfDateLabel } from "../shared/asset-valuation";
import { BANK_HELP } from "../shared/help-texts";
import { AssetValueChart, SERIES_COLORS } from "./AssetValueChart";
import { Card, SectionTitle } from "./ui";

const mmdd = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

type Props = {
  reloadKey: number;
  /** 「表示する銀行」で選んだ口座。null / 省略はすべての口座 */
  accountId?: number | null;
};

export function CashFlowTrend({ reloadKey, accountId = null }: Props) {
  const [data, setData] = useState<CashOutlook | null>(null);

  useEffect(() => {
    fetchCashOutlook()
      .then(setData)
      .catch(() => setData(null));
  }, [reloadKey]);

  if (!data || data.accounts.length === 0) return null;
  const single = accountId === null ? null : data.accounts.find((a) => a.id === accountId);
  if (accountId !== null && !single) return null;

  const currentIndex = data.months.indexOf(data.currentKey);
  const lastIndex = data.months.length - 1;
  const todayTotal = single ? single.balance : data.accounts.reduce((sum, a) => sum + a.balance, 0);
  const budgetMonths = data.totalBasis.filter((b, i) => i > currentIndex && b === "budget").length;
  const ruleMonths = data.totalBasis.filter((b) => b === "rule").length;
  const lastKey = data.months[lastIndex];
  const lastLabel = `${lastKey.slice(0, 4)}年${Number(lastKey.slice(5))}月`;

  return (
    <Card>
      <SectionTitle note={BANK_HELP.trend}>残高の推移</SectionTitle>
      <Text style={s.muted}>
        {single ? `${single.name}の残高` : "総残高"}（{asOfDateLabel(new Date())}）
      </Text>
      <Text style={s.totalValue}>{yen(todayTotal)}</Text>
      <Text style={s.muted}>
        {lastLabel}末の見込み{" "}
        {yen(single ? (single.values[lastIndex] ?? 0) : data.total[lastIndex])} ・{" "}
        {single
          ? "予算は口座ごとに分かれていないため、先はこの口座の毎月の入出金から見込み"
          : budgetMonths === 0
            ? "予算がないため、先は毎月の入出金から見込み"
            : ruleMonths === 0
              ? `先の ${budgetMonths} か月は予算から見込み`
              : `先の ${budgetMonths} か月は予算、予算のない ${ruleMonths} か月は毎月の入出金から見込み`}
      </Text>
      <AssetValueChart
        months={data.months}
        currentKey={data.currentKey}
        series={[
          single
            ? {
                key: `a${single.id}`,
                label: "残高",
                color: SERIES_COLORS[0],
                values: single.values,
              }
            : { key: "total", label: "合計", color: SERIES_COLORS[0], values: data.total },
        ]}
        height={180}
      />
      {!single && <Text style={s.subTitle}>口座ごとの推移</Text>}
      {!single &&
        data.accounts.map((a) => {
          return (
            <View key={a.id} style={s.trendItem}>
              <Text style={s.trendName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={s.muted}>
                今の残高 {yen(a.balance)} ・ {lastLabel}末の見込み {yen(a.values[lastIndex] ?? 0)}
              </Text>
              <AssetValueChart
                months={data.months}
                currentKey={data.currentKey}
                series={[
                  { key: `a${a.id}`, label: "残高", color: SERIES_COLORS[0], values: a.values },
                ]}
                height={110}
              />
            </View>
          );
        })}
    </Card>
  );
}

const s = StyleSheet.create({
  totalValue: { fontSize: 20, fontWeight: "700", color: "#4f46e5" },
  subTitle: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 12, marginBottom: 6 },
  trendItem: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 8, marginTop: 8 },
  trendName: { fontSize: 13, fontWeight: "600", color: "#1e293b", flexShrink: 1 },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 3 },
  short: { fontSize: 11, color: "#dc2626", fontWeight: "600", marginTop: 3 },
});
