// 仕訳帳（web 版 /journals の一覧と同じ表示を閲覧のみで出す。仕訳の入力・承認・削除・証憑の添付は web 版）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchJournals, type JournalEntry, type ViewMode } from "../api";
import { Card, EmptyText, Notice, Pills } from "../components/ui";
import { fmtDate, MONTHS, yenJa } from "../format";
import { displayName } from "../shared/display-name";

// web 版と同じ区分名
const APPROVAL_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: "下書き", bg: "#f1f5f9", color: "#64748b" },
  pending: { label: "承認待ち", bg: "#fef3c7", color: "#b45309" },
  approved: { label: "承認済", bg: "#dcfce7", color: "#15803d" },
  rejected: { label: "差戻し", bg: "#fee2e2", color: "#b91c1c" },
};
const PAYMENT_LABELS: Record<string, string> = {
  cash: "現金",
  bank: "銀行振込",
  card: "クレジット",
  transfer: "口座引落",
};
const TAX_LABELS: Record<string, string> = {
  taxable: "課税",
  exempt: "非課税",
  non_taxable: "不課税",
};

type Props = { viewMode: ViewMode };

export function JournalsScreen({ viewMode }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchJournals(year, month);
      setEntries(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
      setEntries([]);
    }
  }, [year, month]);

  useEffect(() => {
    setEntries(null);
    load();
  }, [load]);

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
        仕訳の入力・承認・削除と証憑の添付は Web 版から行ってください（モバイルでは閲覧のみ）。
      </Notice>
      <Pills
        options={Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => ({
          value: y,
          label: `${y}年`,
        }))}
        value={year}
        onChange={setYear}
      />
      <Pills
        options={MONTHS.map((m) => ({ value: m, label: `${m}月` }))}
        value={month}
        onChange={setMonth}
      />
      <Text style={s.count}>{total}件</Text>
      {error && <Notice tone="error">{error}</Notice>}

      {entries === null ? (
        <ActivityIndicator color="#4f46e5" style={{ marginTop: 32 }} />
      ) : entries.length === 0 ? (
        <EmptyText>仕訳データがありません。</EmptyText>
      ) : (
        entries.map((e) => {
          const debits = e.details.filter((d) => d.side === "debit");
          const credits = e.details.filter((d) => d.side === "credit");
          const sum = debits.reduce((acc, d) => acc + Number(d.amount), 0);
          const ap = APPROVAL_LABELS[e.approvalStatus ?? "approved"] ?? APPROVAL_LABELS.approved;
          return (
            <Card key={e.id}>
              <View style={s.head}>
                <Text style={s.date}>{fmtDate(e.transactionDate)}</Text>
                <Text style={s.tag}>{PAYMENT_LABELS[e.paymentMethod] ?? e.paymentMethod}</Text>
                <Text style={[s.tag, s.tagTax]}>{TAX_LABELS[e.taxCategory] ?? e.taxCategory}</Text>
                <Text style={[s.status, { backgroundColor: ap.bg, color: ap.color }]}>
                  {ap.label}
                </Text>
              </View>
              <View style={s.titleRow}>
                <Text style={s.desc}>{e.description}</Text>
                <Text style={s.total}>{yenJa(sum)}</Text>
              </View>
              {[...debits, ...credits].map((d) => (
                <View key={d.id} style={[s.line, d.side === "debit" ? s.lineDebit : s.lineCredit]}>
                  <Text style={[s.side, { color: d.side === "debit" ? "#2563eb" : "#ea580c" }]}>
                    {d.side === "debit" ? "借方" : "貸方"}
                  </Text>
                  <Text style={s.account} numberOfLines={1}>
                    <Text style={s.code}>{d.account.code} </Text>
                    {displayName(d.account, viewMode)}
                  </Text>
                  <Text style={s.amount}>{yenJa(Number(d.amount))}</Text>
                </View>
              ))}
              {e.details.some((d) => d.note) && (
                <Text style={s.note}>
                  {e.details
                    .filter((d) => d.note)
                    .map((d) => d.note)
                    .join(" / ")}
                </Text>
              )}
              {e.receipts.length > 0 && (
                <Text style={s.note}>📎 証憑 {e.receipts.map((r) => r.fileName).join("、")}</Text>
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, paddingBottom: 32 },
  count: { fontSize: 11, color: "#94a3b8", marginVertical: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  date: { fontSize: 11, color: "#94a3b8" },
  tag: {
    fontSize: 10,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  tagTax: { color: "#4f46e5", backgroundColor: "#eef2ff" },
  status: {
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 6,
    gap: 8,
  },
  desc: { fontSize: 13, fontWeight: "600", color: "#334155", flex: 1 },
  total: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  lineDebit: { backgroundColor: "#eff6ff66" },
  lineCredit: { backgroundColor: "#fff7ed66" },
  side: { fontSize: 11, fontWeight: "700", width: 30 },
  account: { fontSize: 12, color: "#475569", flex: 1 },
  code: { fontSize: 10, color: "#94a3b8" },
  amount: { fontSize: 12, fontWeight: "600", color: "#334155" },
  note: { fontSize: 11, color: "#94a3b8", marginTop: 6 },
});
