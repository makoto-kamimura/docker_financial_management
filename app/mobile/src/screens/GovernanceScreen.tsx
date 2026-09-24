// 法人ガバナンス（web 版 /governance と同じ 4 タブを閲覧のみで出す。追加・削除は web 版）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchGovernance, type Governance } from "../api";
import { Card, EmptyText, Notice, SelectField, TabBar } from "../components/ui";
import { yen } from "../format";

type Tab = "officers" | "meetings" | "dividends" | "announcements";

const ANNOUNCEMENT_METHOD: Record<string, string> = {
  KANPO: "官報",
  NEWSPAPER: "日刊紙",
  WEBSITE: "ウェブサイト",
};

// 任期満了まで 90 日以内（web 版と同じ判定）
function isExpiringSoon(termEnd: string) {
  const diff = (new Date(termEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 90;
}

export function GovernanceScreen() {
  const [tab, setTab] = useState<Tab>("officers");
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [data, setData] = useState<Governance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchGovernance(tenantId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    }
  }, [tenantId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const tabs = [
    ["officers", `役員管理 (${data?.officers.length ?? 0})`],
    ["meetings", `株主総会 (${data?.meetings.length ?? 0})`],
    ["dividends", `配当管理 (${data?.dividends.length ?? 0})`],
    ["announcements", `決算公告 (${data?.announcements.length ?? 0})`],
  ] as const;

  return (
    <View style={s.root}>
      <TabBar tabs={tabs} value={tab} onChange={setTab} />
      <ScrollView
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
          役員・株主総会・配当・決算公告の追加と削除は Web
          版から行ってください（モバイルでは閲覧のみ）。
        </Notice>
        <SelectField<number | 0>
          label="テナント"
          value={tenantId ?? 0}
          options={[
            { value: 0, label: "全テナント" },
            ...(data?.tenants ?? []).map((t) => ({ value: t.id, label: t.name })),
          ]}
          onChange={(id) => setTenantId(id === 0 ? null : id)}
        />
        {error && <Notice tone="error">{error}</Notice>}

        {!data ? (
          !error && <ActivityIndicator color="#4f46e5" style={{ marginTop: 32 }} />
        ) : (
          <>
            {tab === "officers" &&
              (data.officers.length === 0 ? (
                <EmptyText>役員情報がありません。</EmptyText>
              ) : (
                data.officers.map((o) => (
                  <Card key={o.id}>
                    <Text style={s.title}>
                      {o.name} <Text style={s.sub}>/ {o.title}</Text>
                    </Text>
                    {isExpiringSoon(o.termEnd) && <Text style={s.warn}>任期満了まで90日以内</Text>}
                    <Text style={s.sub}>
                      任期: {o.termStart.slice(0, 10)} 〜 {o.termEnd.slice(0, 10)}
                      {o.salary ? ` ・ 報酬: ${yen(Number(o.salary))}/月` : ""}
                    </Text>
                  </Card>
                ))
              ))}

            {tab === "meetings" &&
              (data.meetings.length === 0 ? (
                <EmptyText>株主総会の記録がありません。</EmptyText>
              ) : (
                data.meetings.map((m) => (
                  <Card key={m.id}>
                    <View style={s.row}>
                      <Text style={[s.badge, m.meetingType === "regular" ? s.regular : s.extra]}>
                        {m.meetingType === "regular" ? "定時" : "臨時"}
                      </Text>
                      <Text style={s.title}>{m.meetingDate.slice(0, 10)}</Text>
                    </View>
                    <Text style={s.body}>議題: {m.agenda}</Text>
                    {m.resolution && <Text style={s.sub}>決議: {m.resolution}</Text>}
                  </Card>
                ))
              ))}

            {tab === "dividends" &&
              (data.dividends.length === 0 ? (
                <EmptyText>配当記録がありません。</EmptyText>
              ) : (
                data.dividends.map((d) => (
                  <Card key={d.id}>
                    <Text style={s.sub}>
                      決議日 {d.resolutionDate.slice(0, 10)} ・ 支払日 {d.paymentDate.slice(0, 10)}
                    </Text>
                    <Text style={s.body}>1株配当 {yen(Number(d.perShareAmount))}</Text>
                    <Text style={s.title}>配当総額 {yen(Number(d.totalAmount))}</Text>
                  </Card>
                ))
              ))}

            {tab === "announcements" &&
              (data.announcements.length === 0 ? (
                <EmptyText>決算公告の記録がありません。</EmptyText>
              ) : (
                data.announcements.map((a) => (
                  <Card key={a.id}>
                    <View style={s.row}>
                      <Text style={s.badge}>{ANNOUNCEMENT_METHOD[a.method] ?? "ウェブサイト"}</Text>
                      <Text style={s.title}>{a.announcementDate.slice(0, 10)}</Text>
                      <Text style={s.sub}>/ {a.fiscalYear}年度</Text>
                    </View>
                    {a.content && <Text style={s.body}>{a.content}</Text>}
                  </Card>
                ))
              ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  title: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  sub: { fontSize: 12, color: "#64748b", marginTop: 2, fontWeight: "400" },
  body: { fontSize: 13, color: "#334155", marginTop: 2 },
  warn: {
    alignSelf: "flex-start",
    fontSize: 10,
    color: "#a16207",
    backgroundColor: "#fef9c3",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 4,
  },
  badge: {
    fontSize: 10,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  regular: { backgroundColor: "#dbeafe", color: "#1d4ed8" },
  extra: { backgroundColor: "#ffedd5", color: "#c2410c" },
});
