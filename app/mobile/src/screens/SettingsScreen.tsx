// 設定（web 版 /settings と同じ 5 区分を閲覧のみで表示する。変更は web 版で行う）。
// 予算配分ルールの編集は web 版と同じく予算画面の「予算配分」タブへ移した。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchAccounts, fetchSettingsSnapshot, type Account, type SettingsSnapshot } from "../api";
import { Card, EmptyText, Notice, SectionTitle, TabBar } from "../components/ui";
import { CATEGORY_LABEL, categoryRank } from "../shared/labels";

type Tab = "profile" | "tax" | "security" | "accountNames" | "departments";
const TABS = [
  ["profile", "事業者情報"],
  ["tax", "消費税設定"],
  ["security", "セキュリティ"],
  ["accountNames", "科目名設定"],
  ["departments", "部門・担当"],
] as const;

// 課税方式（web 版の TAX_TYPE_LABELS / PAYMENT_METHODS と同じ）
const TAX_TYPE_LABELS: Record<string, string> = {
  exempt: "免税事業者",
  general: "課税事業者（原則課税）",
  simplified: "課税事業者（簡易課税）",
};
const PAYMENT_METHODS: Record<string, string> = {
  exempt: "免税",
  general: "原則課税",
  simplified: "簡易課税",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value || "—"}</Text>
    </View>
  );
}

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>("profile");
  const [data, setData] = useState<SettingsSnapshot | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [snap, accs] = await Promise.all([fetchSettingsSnapshot(), fetchAccounts()]);
      setData(snap);
      setAccounts(accs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const profile = data?.profile;
  const sortedAccounts = [...accounts].sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.code.localeCompare(b.code),
  );

  return (
    <View style={s.root}>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
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
        <Notice>設定の変更は Web 版から行ってください（モバイルでは閲覧のみ）。</Notice>
        {error && <Notice tone="error">{error}</Notice>}
        {!data ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 32 }} />
        ) : (
          <>
            {tab === "profile" && (
              <Card>
                <SectionTitle>事業者情報（F001）</SectionTitle>
                <Row label="屋号" value={profile?.tradeName ?? ""} />
                <Row label="氏名" value={profile?.ownerName ?? ""} />
                <Row label="開業日" value={profile?.openedOn?.slice(0, 10) ?? ""} />
                <Row
                  label="既定の課税方式"
                  value={
                    TAX_TYPE_LABELS[profile?.taxationType ?? "exempt"] ??
                    profile?.taxationType ??
                    ""
                  }
                />
                <Row label="インボイス登録番号" value={profile?.invoiceNumber ?? ""} />
                <Row
                  label="青色申告（65万円控除）"
                  value={profile?.blueReturn ? "する" : "しない"}
                />
              </Card>
            )}

            {tab === "tax" && (
              <Card>
                <SectionTitle>消費税設定（F012）</SectionTitle>
                {data.taxSettings.length === 0 ? (
                  <EmptyText>
                    年度別の設定はありません（事業者情報の既定の課税方式を使います）。
                  </EmptyText>
                ) : (
                  data.taxSettings.map((t) => (
                    <Row
                      key={t.taxYear}
                      label={`${t.taxYear}年`}
                      value={`${PAYMENT_METHODS[t.taxationType] ?? t.taxationType}${t.simplifiedRate ? ` ・ みなし仕入率 ${t.simplifiedRate}%` : ""}`}
                    />
                  ))
                )}
              </Card>
            )}

            {tab === "security" && (
              <Card>
                <SectionTitle>多要素認証（MFA / TOTP）</SectionTitle>
                <Row label="状態" value={data.mfaEnabled ? "有効" : "無効"} />
                <Text style={s.muted}>
                  MFA の有効化・無効化とリカバリーコードの再発行は Web 版の「設定 ›
                  セキュリティ」で行います。
                  有効にするとモバイルのログインでも認証コードの入力が必要になります。
                </Text>
              </Card>
            )}

            {tab === "accountNames" && (
              <Card>
                <SectionTitle note="家庭科目名と、個人・法人モードで表示する科目名です。">
                  科目名設定
                </SectionTitle>
                {sortedAccounts.map((a) => (
                  <View key={a.id} style={s.account}>
                    <Text style={s.accountHead}>
                      <Text style={s.code}>{a.code} </Text>
                      {a.name}
                      <Text style={s.category}>　{CATEGORY_LABEL[a.category] ?? a.category}</Text>
                    </Text>
                    <Text style={s.muted}>
                      個人: {a.soleName || "（家庭科目名と同じ）"} ・ 法人:{" "}
                      {a.corporateName || "（家庭科目名と同じ）"}
                    </Text>
                  </View>
                ))}
              </Card>
            )}

            {tab === "departments" && (
              <Card>
                <SectionTitle>部門・担当</SectionTitle>
                {data.departments.length === 0 ? (
                  <EmptyText>部門は登録されていません。</EmptyText>
                ) : (
                  data.departments.map((d) => (
                    <Row key={d.id} label={d.name} value={d.manager ?? ""} />
                  ))
                )}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, paddingBottom: 32 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  rowLabel: { fontSize: 13, color: "#64748b" },
  rowValue: {
    fontSize: 13,
    color: "#1e293b",
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 6 },
  account: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  accountHead: { fontSize: 13, color: "#1e293b" },
  code: { fontSize: 11, color: "#94a3b8" },
  category: { fontSize: 10, color: "#64748b" },
});
