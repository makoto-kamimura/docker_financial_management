// インボイス（web 版 /invoices の一覧・詳細を閲覧のみで出す。作成・発行・入金・削除は web 版）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchInvoices, type Invoice } from "../api";
import { Card, EmptyText, Notice, SheetModal } from "../components/ui";
import { yen } from "../format";

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: "下書き", bg: "#f1f5f9", color: "#475569" },
  issued: { label: "発行済み", bg: "#dbeafe", color: "#1d4ed8" },
  paid: { label: "入金済み", bg: "#dcfce7", color: "#15803d" },
};

export function InvoicesScreen() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInvoices(await fetchInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
      setInvoices([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalOf = (status: string) =>
    (invoices ?? [])
      .filter((i) => i.status === status)
      .reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <View style={s.root}>
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
          インボイスの作成・発行・入金の記録は Web 版から行ってください（モバイルでは閲覧のみ）。
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}

        {/* 状態ごとの合計（web 版と同じ 3 区分） */}
        <View style={s.totals}>
          {(["draft", "issued", "paid"] as const).map((st) => (
            <Card key={st} style={s.totalCard}>
              <Text style={s.totalLabel}>{STATUS[st].label}</Text>
              <Text style={[s.totalValue, { color: STATUS[st].color }]}>{yen(totalOf(st))}</Text>
            </Card>
          ))}
        </View>

        {invoices === null ? (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 32 }} />
        ) : invoices.length === 0 ? (
          <EmptyText>📄 インボイスがありません。</EmptyText>
        ) : (
          invoices.map((inv) => {
            const st = STATUS[inv.status] ?? STATUS.draft;
            return (
              <TouchableOpacity key={inv.id} onPress={() => setPreview(inv)}>
                <Card>
                  <View style={s.head}>
                    <Text style={s.number}>{inv.invoiceNumber}</Text>
                    <Text style={[s.badge, { backgroundColor: st.bg, color: st.color }]}>
                      {st.label}
                    </Text>
                  </View>
                  <Text style={s.customer}>{inv.customerName}</Text>
                  <View style={s.foot}>
                    <Text style={s.muted}>
                      発行日 {inv.issueDate.slice(0, 10)} ・ 支払期限 {inv.dueDate.slice(0, 10)}
                    </Text>
                    <Text style={s.amount}>{yen(Number(inv.total))}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* 請求書詳細（web 版の「詳細」と同じ内容） */}
      <SheetModal visible={preview !== null} title="請求書詳細" onClose={() => setPreview(null)}>
        {preview && (
          <>
            <Text style={s.detail}>番号: {preview.invoiceNumber}</Text>
            <Text style={s.detail}>取引先: {preview.customerName}</Text>
            {preview.customerAddress && (
              <Text style={s.detail}>住所: {preview.customerAddress}</Text>
            )}
            <Text style={s.detail}>
              発行日: {preview.issueDate.slice(0, 10)} / 支払期限: {preview.dueDate.slice(0, 10)}
            </Text>
            <View style={s.lines}>
              {preview.lines.map((l, i) => (
                <View key={i} style={s.line}>
                  <Text style={s.lineDesc}>{l.description}</Text>
                  <Text style={s.muted}>
                    {Number(l.quantity)} × {yen(Number(l.unitPrice))} ・ 税率{" "}
                    {(Number(l.taxRate) * 100).toFixed(0)}%
                  </Text>
                  <Text style={s.lineAmount}>{yen(Number(l.amount))}</Text>
                </View>
              ))}
            </View>
            <Text style={s.sum}>小計: {yen(Number(preview.subtotal))}</Text>
            <Text style={s.sum}>消費税: {yen(Number(preview.taxAmount))}</Text>
            <Text style={[s.sum, s.grand]}>合計: {yen(Number(preview.total))}</Text>
            {preview.note && <Text style={s.muted}>備考: {preview.note}</Text>}
          </>
        )}
      </SheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 14, paddingBottom: 32 },
  totals: { flexDirection: "row", gap: 8 },
  totalCard: { flex: 1, padding: 10 },
  totalLabel: { fontSize: 11, color: "#64748b" },
  totalValue: { fontSize: 15, fontWeight: "700", marginTop: 2 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  number: { fontSize: 11, color: "#64748b" },
  badge: {
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  customer: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginTop: 4 },
  foot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  muted: { fontSize: 11, color: "#94a3b8" },
  amount: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  detail: { fontSize: 13, color: "#334155", marginBottom: 3 },
  lines: { borderTopWidth: 1, borderTopColor: "#e2e8f0", marginVertical: 10 },
  line: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  lineDesc: { fontSize: 13, color: "#1e293b" },
  lineAmount: { fontSize: 13, fontWeight: "600", color: "#334155", textAlign: "right" },
  sum: { fontSize: 13, color: "#334155", textAlign: "right", marginTop: 2 },
  grand: { fontSize: 15, fontWeight: "700" },
});
