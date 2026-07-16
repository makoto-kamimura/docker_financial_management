import { useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native";
import {
  applyAllocationToBudget, getAllocation,
  type AllocationGroup, type AllocationItem, type ViewMode,
} from "../api";

const GROUP_ORDER: AllocationGroup[] = ["固定費", "生活費", "その他"];

const RULE_502030 = [
  { label: "生活必需費（家賃・光熱費・食費・通信費など）", percent: 50 },
  { label: "自由に使えるお金（趣味・外食・旅行など）",     percent: 30 },
  { label: "貯蓄・投資・借金返済",                         percent: 20 },
];

const yen = (v: number) =>
  v === 0 ? "¥0"
  : Math.abs(v) >= 10_000
    ? `¥${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万`
    : `¥${Math.round(v).toLocaleString("ja-JP")}`;

function pctText(item: AllocationItem): string {
  return item.maxPercent === null
    ? `${item.minPercent}%以上`
    : `${item.minPercent}〜${item.maxPercent}%`;
}

function amountText(total: number, item: AllocationItem): string {
  const min = Math.round(total * item.minPercent / 100);
  if (item.maxPercent === null) return `${yen(min)}以上`;
  const max = Math.round(total * item.maxPercent / 100);
  return `${yen(min)} 〜 ${yen(max)}`;
}

// Web の suggestAllocation() と同じ式（下限・上限の中央値。上限なしは下限）で推奨額を算出する。
function recommendedAmount(total: number, item: AllocationItem): number {
  const percent = item.maxPercent === null ? item.minPercent : (item.minPercent + item.maxPercent) / 2;
  return Math.round(total * percent / 100);
}

type RevenueLine = { code: string; name: string; amount: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  year: number;
  month: number;
  items: RevenueLine[];
  total: number;
  viewMode: ViewMode;
  /** 予算への反映が成功した後に呼ばれる（呼び出し側で予算一覧を再取得する） */
  onApplied?: () => void;
};

export function RevenueAllocationModal({ visible, onClose, year, month, items, total, viewMode, onApplied }: Props) {
  const allocation = getAllocation();
  const fixedMin = Math.round(total * 0.45);
  const fixedMax = Math.round(total * 0.55);
  const [applying, setApplying] = useState(false);

  async function applyToBudget() {
    const applyItems = allocation
      .filter(a => a.accountId != null)
      .map(a => ({
        accountId: a.accountId as number,
        month,
        amount: recommendedAmount(total, a),
      }))
      .filter(a => a.amount > 0);

    if (applyItems.length === 0) {
      Alert.alert("反映できません", "対応科目が設定された配分ルールがありません。「その他」→「設定」で科目を紐付けてください。");
      return;
    }

    setApplying(true);
    try {
      await applyAllocationToBudget(year, applyItems);
      Alert.alert("反映しました", `${applyItems.length}件の科目に${month}月の予算として反映しました。`);
      onApplied?.();
      onClose();
    } catch {
      Alert.alert("エラー", "予算への反映に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.header}>
            <View>
              <Text style={s.title}>{year}年{month}月 収入・売上</Text>
              <Text style={s.sub}>内訳とおすすめ予算配分</Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body}>
            {/* 入力済み科目一覧 */}
            <Text style={s.sectionLabel}>入力済みの科目</Text>
            {items.length === 0 ? (
              <Text style={s.empty}>収入・売上の金額が入力されていません</Text>
            ) : (
              <View style={s.card}>
                {items.map(it => (
                  <View key={it.code} style={s.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lineCode}>{it.code}</Text>
                      <Text style={s.lineName}>{it.name}</Text>
                    </View>
                    <Text style={s.lineAmt}>{yen(it.amount)}</Text>
                  </View>
                ))}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>合計</Text>
                  <Text style={s.totalAmt}>{yen(total)}</Text>
                </View>
              </View>
            )}

            {/* おすすめ予算配分 */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>おすすめ予算配分（FP推奨）</Text>
            {GROUP_ORDER.map(group => {
              const groupItems = allocation.filter(a => a.group === group);
              if (groupItems.length === 0) return null;
              return (
                <View key={group} style={s.groupBlock}>
                  <Text style={s.groupTitle}>{group}</Text>
                  {groupItems.map(item => (
                    <View key={item.key} style={s.allocRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.allocLabel}>{item.label}</Text>
                        {item.note && <Text style={s.allocNote}>{item.note}</Text>}
                      </View>
                      <View style={s.allocRight}>
                        <Text style={s.allocPct}>{pctText(item)}</Text>
                        <Text style={s.allocAmt}>{amountText(total, item)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}

            {/* 参考: 固定費合計・50-30-20ルール */}
            <View style={s.refCard}>
              <Text style={s.refTitle}>固定費合計の目安（45〜55%）</Text>
              <Text style={s.refAmt}>{yen(fixedMin)} 〜 {yen(fixedMax)}</Text>
            </View>

            <View style={s.refCard}>
              <Text style={s.refTitle}>50-30-20ルール</Text>
              {RULE_502030.map(r => (
                <View key={r.label} style={s.ruleRow}>
                  <Text style={s.ruleLabel}>{r.label}</Text>
                  <Text style={s.ruleAmt}>{r.percent}% ・ {yen(Math.round(total * r.percent / 100))}</Text>
                </View>
              ))}
            </View>

            {viewMode === "sole" && (
              <View style={s.refCard}>
                <Text style={s.refTitle}>個人事業主向け</Text>
                <Text style={s.soleTxt}>・年間平均の手取り収入を基準に家計を組む{"\n"}・事業用と生活用のお金は分ける{"\n"}・生活費は毎月一定額を事業口座から移す{"\n"}・収入が変動する場合、固定費は手取りの40〜45%程度に抑えると安心</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.applyBtn, (applying || total <= 0) && s.applyBtnDisabled]}
              onPress={applyToBudget}
              disabled={applying || total <= 0}
            >
              {applying
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.applyBtnTxt}>{month}月の予算に反映</Text>
              }
            </TouchableOpacity>

            <Text style={s.footNote}>配分の割合は「その他」→「設定」画面から変更できます。</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "88%" },
  header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 22, paddingBottom: 12 },
  title:        { fontSize: 18, fontWeight: "700", color: "#1e293b" },
  sub:          { fontSize: 12, color: "#64748b", marginTop: 2 },
  closeBtn:     { padding: 6 },
  closeTxt:     { fontSize: 18, color: "#94a3b8" },
  body:         { paddingHorizontal: 22, paddingBottom: 36 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  empty:        { fontSize: 13, color: "#94a3b8", paddingVertical: 12 },
  card:         { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12, backgroundColor: "#f8fafc" },
  lineRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  lineCode:     { fontSize: 10, color: "#94a3b8" },
  lineName:     { fontSize: 13, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  lineAmt:      { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  totalRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  totalLabel:   { fontSize: 13, fontWeight: "700", color: "#4f46e5" },
  totalAmt:     { fontSize: 17, fontWeight: "700", color: "#4f46e5" },
  groupBlock:   { marginBottom: 14 },
  groupTitle:   { fontSize: 13, fontWeight: "700", color: "#4f46e5", marginBottom: 6 },
  allocRow:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  allocLabel:   { fontSize: 13, color: "#1e293b", fontWeight: "500" },
  allocNote:    { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  allocRight:   { alignItems: "flex-end" },
  allocPct:     { fontSize: 11, color: "#64748b" },
  allocAmt:     { fontSize: 13, fontWeight: "700", color: "#1e293b", marginTop: 2 },
  refCard:      { backgroundColor: "#eef2ff", borderRadius: 12, padding: 12, marginTop: 12 },
  refTitle:     { fontSize: 12, fontWeight: "700", color: "#4f46e5", marginBottom: 6 },
  refAmt:       { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  ruleRow:      { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  ruleLabel:    { fontSize: 11, color: "#475569", flex: 1, marginRight: 8 },
  ruleAmt:      { fontSize: 11, fontWeight: "700", color: "#1e293b" },
  soleTxt:      { fontSize: 12, color: "#475569", lineHeight: 19 },
  applyBtn:     { backgroundColor: "#4f46e5", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 20 },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnTxt:  { fontSize: 14, fontWeight: "700", color: "#fff" },
  footNote:     { fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 10 },
});
