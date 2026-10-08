// 実績の画面の「履歴」の共通の行（web 版 components/LedgerTable.tsx と同じ並び）。
// 出どころ（手動 / 銀行 / カード・電子マネー）が違っても、
//   1 段目: 日付 · 口座 ……… 金額
//   2 段目: 摘要
//   3 段目: 科目・状態のバッジ・操作
// の同じ形で見せる。行の中身（科目の選択・状態・操作）は呼び出し側が渡す。
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  date: string;
  account: string;
  description: string;
  amount: string;
  /** in = 入金・収入（緑）、out = 出金・支出（赤）、none = 色なし */
  tone: "in" | "out" | "none";
  category?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
};

export function LedgerRow({
  date,
  account,
  description,
  amount,
  tone,
  category,
  status,
  actions,
}: Props) {
  return (
    <View style={s.row}>
      <View style={s.head}>
        <Text style={s.meta} numberOfLines={1}>
          {date} · {account}
        </Text>
        <Text style={[s.amount, tone === "in" ? s.in : tone === "out" ? s.out : null]}>
          {amount}
        </Text>
      </View>
      <Text style={s.desc} numberOfLines={2}>
        {description}
      </Text>
      <View style={s.foot}>
        {category}
        {status}
        {actions && <View style={s.actions}>{actions}</View>}
      </View>
    </View>
  );
}

/** 状態のバッジ（web 版の LedgerBadge と同じ色の使い方） */
export function LedgerBadge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "emerald" | "sky" | "indigo" | "amber";
  children: ReactNode;
}) {
  return <Text style={[s.badge, badgeTone[tone]]}>{children}</Text>;
}

/** 表の上の件数（web 版と同じ書き方） */
export function LedgerCount({
  total,
  offset,
  pageSize,
}: {
  total: number;
  offset: number;
  pageSize: number;
}) {
  return (
    <Text style={s.count}>
      {total > 0
        ? `全 ${total.toLocaleString("ja-JP")} 件中 ${offset + 1}〜${Math.min(offset + pageSize, total)} 件を表示`
        : "0 件"}
    </Text>
  );
}

const badgeTone = StyleSheet.create({
  slate: { backgroundColor: "#f1f5f9", color: "#475569" },
  emerald: { backgroundColor: "#ecfdf5", color: "#047857" },
  sky: { backgroundColor: "#f0f9ff", color: "#0369a1" },
  indigo: { backgroundColor: "#eef2ff", color: "#4f46e5" },
  amber: { backgroundColor: "#fffbeb", color: "#b45309" },
});

const s = StyleSheet.create({
  row: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  meta: { fontSize: 11, color: "#94a3b8", flexShrink: 1 },
  amount: { fontSize: 14, fontWeight: "700", color: "#334155" },
  out: { color: "#dc2626" },
  in: { color: "#059669" },
  desc: { fontSize: 13, color: "#334155", marginTop: 3 },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: "auto" },
  badge: {
    fontSize: 10,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  count: { fontSize: 11, color: "#64748b", marginBottom: 6 },
});
