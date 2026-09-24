// 資金繰り（必要残高と入金期限）。web 版 components/FundingPlanPanel.tsx と同じ内容。
// 現在残高と資金移動ルールから、対象年月を起点に N か月分の引き落とし予定を時系列に並べ、
// 残高が足りなくなる日（＝この日までに預け入れないと処理されない日）と必要額を示す。
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetchFundingPlan, type FundingResponse } from "../api";
import { yen } from "../format";
import { Card, SectionTitle } from "./ui";

const mmdd = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

type Props = { year: number; month: number; months?: number; reloadKey?: number };

export function FundingPlanView({ year, month, months = 3, reloadKey = 0 }: Props) {
  const [data, setData] = useState<FundingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchFundingPlan(year, month, months)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [year, month, months, reloadKey]);

  if (error) return <Text style={s.error}>{error}</Text>;
  if (!data) return <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />;

  const shortPlans = data.plans.filter((p) => p.requiredDeposit > 0);
  const activePlans = data.plans.filter((p) => p.events.length > 0);

  return (
    <>
      {shortPlans.length > 0 ? (
        <Card style={s.alert}>
          <Text style={s.alertTitle}>⚠ 預け入れが必要な口座</Text>
          {shortPlans.map((p) => (
            <View key={p.accountId} style={{ marginTop: 6 }}>
              <Text style={s.alertText}>
                <Text style={s.bold}>{p.accountName}</Text> は{" "}
                <Text style={s.bold}>{p.deadline ? mmdd(p.deadline) : ""}</Text> の
                {p.trigger ? `「${p.trigger.label}」` : "引き落とし"}までに{" "}
                <Text style={s.bold}>{yen(Math.abs(p.trigger?.balanceAfter ?? 0))}</Text>{" "}
                以上を預け入れないと引き落としできません。
              </Text>
              <Text style={s.alertSub}>
                {data.months}か月間で最も残高が減るのは
                {p.minBalanceDate ? ` ${mmdd(p.minBalanceDate)} ` : ""}（{yen(p.minBalance)}
                ）。この期間を通すには合計 {yen(p.requiredDeposit)} の追加入金が必要です。
              </Text>
            </View>
          ))}
        </Card>
      ) : (
        <Card style={s.ok}>
          <Text style={s.okText}>
            ✓ 現在残高と資金移動の設定では、{data.months}か月間で残高不足は発生しません。
          </Text>
        </Card>
      )}

      <Card>
        <SectionTitle
          note={
            `現在残高（明細の合計＋差額）を起点に、資金移動の設定から${data.year}年${data.month}月以降 ` +
            `${data.months} か月分の予定を時系列に並べています。残高がマイナスになる予定は赤で示し、` +
            "最初にマイナスになる予定が「預け入れの期限」です。"
          }
        >
          口座別の資金繰りフロー
        </SectionTitle>
        {activePlans.length === 0 ? (
          <Text style={s.muted}>
            資金移動が設定されていません。「振替」タブのスケジュールで毎月の入出金を登録すると表示されます。
          </Text>
        ) : (
          activePlans.map((p) => (
            <View key={p.accountId} style={s.plan}>
              <Text style={s.planHead}>
                <Text style={s.bold}>{p.accountName}</Text>
                {"  "}現在残高 {yen(p.opening)} → {data.months}か月後 {yen(p.closing)}
              </Text>
              {p.requiredDeposit > 0 && (
                <Text style={s.planWarn}>
                  {p.deadline ? mmdd(p.deadline) : ""} までに {yen(p.requiredDeposit)} の入金が必要
                </Text>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.flow}>
                  <View style={[s.box, s.boxStart]}>
                    <Text style={s.boxDate}>現在</Text>
                    <Text style={s.boxLabel}>残高</Text>
                    <Text style={s.boxBalance}>{yen(p.opening)}</Text>
                  </View>
                  {p.events.map((e, i) => {
                    const isTrigger = p.trigger !== null && p.events.indexOf(p.trigger) === i;
                    const negative = e.balanceAfter < 0;
                    return (
                      <View key={i} style={s.step}>
                        <Text style={s.arrow}>→</Text>
                        <View style={[s.box, negative && s.boxNegative]}>
                          <Text style={s.boxDate}>{mmdd(e.date)}</Text>
                          <Text style={s.boxLabel} numberOfLines={1}>
                            {e.label}
                          </Text>
                          <Text style={e.amount < 0 ? s.out : s.in}>
                            {e.amount < 0 ? "−" : "+"}
                            {yen(Math.abs(e.amount))}
                          </Text>
                          <Text style={[s.boxBalance, negative && s.negative]}>
                            {yen(e.balanceAfter)}
                          </Text>
                          {isTrigger && <Text style={s.trigger}>この日までに入金</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  error: { color: "#dc2626", fontSize: 13, marginVertical: 8 },
  alert: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  alertTitle: { fontSize: 14, fontWeight: "700", color: "#b91c1c" },
  alertText: { fontSize: 12, color: "#991b1b", lineHeight: 18 },
  alertSub: { fontSize: 11, color: "#b91c1c", marginTop: 2, lineHeight: 16 },
  ok: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  okText: { fontSize: 12, color: "#15803d" },
  bold: { fontWeight: "700" },
  muted: { fontSize: 12, color: "#94a3b8" },
  plan: { marginBottom: 14 },
  planHead: { fontSize: 12, color: "#475569", marginBottom: 2 },
  planWarn: { fontSize: 11, color: "#dc2626", fontWeight: "600", marginBottom: 4 },
  flow: { flexDirection: "row", alignItems: "stretch", gap: 4, paddingVertical: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 4 },
  arrow: { fontSize: 12, color: "#cbd5e1" },
  box: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 100,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  boxStart: { backgroundColor: "#f8fafc" },
  boxNegative: { borderColor: "#fca5a5", backgroundColor: "#fef2f2" },
  boxDate: { fontSize: 9, color: "#94a3b8" },
  boxLabel: { fontSize: 11, color: "#334155", maxWidth: 120 },
  boxBalance: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  negative: { color: "#dc2626" },
  out: { fontSize: 11, color: "#e11d48" },
  in: { fontSize: 11, color: "#059669" },
  trigger: {
    marginTop: 3,
    fontSize: 9,
    color: "#fff",
    backgroundColor: "#ef4444",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: "hidden",
  },
});
