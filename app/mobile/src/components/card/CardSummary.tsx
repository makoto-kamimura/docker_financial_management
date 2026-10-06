// カード・電子マネー管理の「サマリ」（web 版 /card-transactions のサマリタブと同じ。借入金の画面と同じ並び）。
// 利用額の推移（合計とカードごと。先は固定決済の合計で見込む）と、カード・電子マネーの一覧。
// 一覧の行から編集・削除と、実績の画面の履歴でそのカードの明細を開ける。
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  fetchCardFlow,
  fetchCardUsageTrend,
  type CardFlowResponse,
  type CardUsageTrend,
  type LinkedAccount,
} from "../../api";
import { yen } from "../../format";
import { asOfDateLabel } from "../../shared/asset-valuation";
import { CARD_HELP } from "../../shared/help-texts";
import { LINKED_ACCOUNT_TYPE_LABELS } from "../../shared/linked-account-type";
import { AssetValueChart, SERIES_COLORS } from "../AssetValueChart";
import { Button, Card, SectionTitle } from "../ui";

export function CardSummary({
  accounts,
  reloadKey,
  onAdd,
  onEdit,
  onDelete,
  onOpenHistory,
}: {
  accounts: LinkedAccount[];
  reloadKey: number;
  onAdd: () => void;
  onEdit: (a: LinkedAccount) => void;
  onDelete: (a: LinkedAccount) => void;
  onOpenHistory: (accountId: number) => void;
}) {
  const [trend, setTrend] = useState<CardUsageTrend | null>(null);
  const [flow, setFlow] = useState<CardFlowResponse | null>(null);

  useEffect(() => {
    fetchCardUsageTrend()
      .then(setTrend)
      .catch(() => setTrend(null));
    fetchCardFlow()
      .then(setFlow)
      .catch(() => setFlow(null));
  }, [reloadKey]);

  const currentIndex = trend ? trend.months.indexOf(trend.currentKey) : -1;
  const usageOf = (id: number | null) => {
    if (!trend || currentIndex < 0) return 0;
    return id === null
      ? (trend.total[currentIndex] ?? 0)
      : (trend.cards.find((c) => c.id === id)?.values[currentIndex] ?? 0);
  };

  return (
    <>
      {/* 利用額の推移（web 版 CardUsageTrendCharts と同じ） */}
      {trend && trend.cards.length > 0 && (
        <Card>
          <SectionTitle note={CARD_HELP.usageTrend}>利用額の推移</SectionTitle>
          <Text style={s.muted}>今月の利用額（{asOfDateLabel(new Date())}）</Text>
          <Text style={s.totalValue}>{yen(usageOf(null))}</Text>
          <AssetValueChart
            months={trend.months}
            currentKey={trend.currentKey}
            series={[{ key: "total", label: "合計", color: SERIES_COLORS[0], values: trend.total }]}
            height={180}
          />
          <Text style={s.subTitle}>カードごとの推移</Text>
          {trend.cards.map((c) => (
            <View key={c.id} style={s.trendItem}>
              <Text style={s.name} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={s.muted}>今月の利用額 {yen(usageOf(c.id))}</Text>
              <AssetValueChart
                months={trend.months}
                currentKey={trend.currentKey}
                series={[
                  { key: `c${c.id}`, label: "利用額", color: SERIES_COLORS[0], values: c.values },
                ]}
                height={110}
              />
            </View>
          ))}
        </Card>
      )}

      {/* カード・電子マネーの一覧（借入金の画面の一覧と同じ形） */}
      <Card>
        <SectionTitle note={CARD_HELP.cards}>カード・電子マネー</SectionTitle>
        {accounts.length > 0 && (
          <Text style={s.muted}>
            今月の利用額の合計 {yen(usageOf(null))} ・ {accounts.length} 件
          </Text>
        )}
        <Button
          small
          label="カード・電子マネー追加"
          onPress={onAdd}
          style={{ marginVertical: 8, alignSelf: "flex-start" }}
        />
        {accounts.length === 0 ? (
          <Text style={s.muted}>カード・電子マネーが登録されていません。</Text>
        ) : (
          accounts.map((a) => {
            const debits = (flow?.transfers ?? []).filter((t) => t.linkedAccountId === a.id);
            const recurring = (flow?.recurring ?? []).filter((r) => r.accountId === a.id);
            const recurringTotal = recurring.reduce((sum, r) => sum + r.amount, 0);
            return (
              <View key={a.id} style={s.row}>
                <View style={s.rowHead}>
                  <Text style={s.badge}>{LINKED_ACCOUNT_TYPE_LABELS[a.type] ?? "カード"}</Text>
                  <Text style={s.name} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={s.usage}>{yen(usageOf(a.id))}</Text>
                </View>
                <Text style={s.muted}>
                  {a.institution}
                  {a.lastFour ? ` ****${a.lastFour}` : ""} ・ 今月の利用額
                </Text>
                {debits.length > 0 ? (
                  debits.map((t) => (
                    <Text key={t.id} style={s.detail}>
                      引き落とし: {t.from ?? "口座未設定"} ・ 毎月{t.day}日 ・ {yen(t.amount)}
                    </Text>
                  ))
                ) : (
                  <Text style={s.muted}>
                    引き落としは未登録（銀行管理のキャッシュフローで登録します）
                  </Text>
                )}
                <Text style={s.detail}>
                  {recurring.length > 0
                    ? `固定決済: ${recurring.length} 件 ・ 月 ${yen(recurringTotal)}`
                    : "固定決済はありません"}
                </Text>
                {a.account && (
                  <Text style={s.linked}>
                    紐付く科目: {a.account.code} {a.account.name}
                  </Text>
                )}
                <View style={s.actions}>
                  <TouchableOpacity onPress={() => onOpenHistory(a.id)}>
                    <Text style={s.link}>明細を見る</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onEdit(a)}>
                    <Text style={s.link}>編集</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(a)}>
                    <Text style={s.danger}>削除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  totalValue: { fontSize: 20, fontWeight: "700", color: "#e11d48" },
  subTitle: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 12, marginBottom: 6 },
  trendItem: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 8, marginTop: 8 },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 2 },
  row: {
    borderWidth: 1,
    borderColor: "#f1f5f9",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: {
    fontSize: 10,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: "hidden",
  },
  name: { fontSize: 13, fontWeight: "600", color: "#1e293b", flexShrink: 1 },
  usage: { marginLeft: "auto", fontSize: 13, fontWeight: "700", color: "#e11d48" },
  detail: { fontSize: 11, color: "#64748b", marginTop: 2 },
  linked: { fontSize: 11, color: "#4f46e5", fontWeight: "600", marginTop: 2 },
  actions: { flexDirection: "row", gap: 16, marginTop: 8 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
});
