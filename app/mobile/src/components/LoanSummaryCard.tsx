// ホームの総借入サマリ（web 版 components/LoanSummaryCard.tsx と同じ）。
// KPI の対象月の時点（月末、今月なら今日）の借入残高・月々の返済額・借入総額と、借入ごとの内訳。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchLoanSummary, type LoanSummary } from "../api";
import { yenShort } from "../format";
import { DASHBOARD_HELP } from "../shared/help-texts";
import { LOAN_TYPE_LABEL } from "../shared/labels";
import { COLORS } from "./ui";

/** 「2026年8月末時点」「2026年10月6日時点」 */
function asOfLabel(s: LoanSummary) {
  const [y, m, d] = s.asOf.split("-").map(Number);
  return s.isCurrentMonth ? `${y}年${m}月${d}日時点` : `${y}年${m}月末時点`;
}

export function LoanSummaryCard({ period, refreshKey }: { period: string; refreshKey: number }) {
  const [data, setData] = useState<LoanSummary | null>(null);

  useEffect(() => {
    const [year, month] = period.split("-").map(Number);
    fetchLoanSummary(year, month)
      .then(setData)
      .catch(() => setData(null));
  }, [period, refreshKey]);

  if (!data || data.loans.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>総借入サマリ（{asOfLabel(data)}）</Text>
      <Text style={s.note}>{DASHBOARD_HELP.loanSummary}</Text>
      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statLabel}>借入残高</Text>
          <Text style={[s.statValue, { color: "#e11d48" }]}>{yenShort(data.totalBalance)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>月々の返済額</Text>
          <Text style={s.statValue}>{yenShort(data.totalMonthlyPayment)}</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statLabel}>借入総額</Text>
          <Text style={s.statValue}>{yenShort(data.totalBorrowed)}</Text>
        </View>
      </View>
      {data.loans.map((l) => (
        <View key={l.id} style={s.row}>
          <Text style={s.rowName}>
            {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType} ・ {l.lenderName}
            {l.assetName ? `（${l.assetName}）` : ""}
          </Text>
          <Text style={s.rowDetail}>
            残高 {yenShort(l.balance)} ・ 月々 {yenShort(l.monthlyPayment)} ・ 金利{" "}
            {(l.interestRate * 100).toFixed(3)}% ・ 完済予定 {l.repaymentDate.slice(0, 7)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  title: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  note: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginBottom: 10 },
  stats: { flexDirection: "row", marginBottom: 10 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, color: "#64748b", marginBottom: 2 },
  statValue: { fontSize: 17, fontWeight: "700", color: "#1e293b" },
  row: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 6 },
  rowName: { fontSize: 12, color: "#334155", fontWeight: "600" },
  rowDetail: { fontSize: 11, color: "#64748b", marginTop: 2 },
});
