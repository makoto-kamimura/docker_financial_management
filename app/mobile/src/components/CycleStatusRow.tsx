// ホームの「予算と実績の確定」の状況（web 版 components/CycleStatusStrip.tsx と同じ）。
// KPI の対象月の ① 予算 → ② 実績 → ③ 翌月の予算 の確定状況を出し、押すと予算・実績の画面の確定タブへ移る。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchCycleStatus, type CycleStatus } from "../api";
import { DASHBOARD_HELP } from "../shared/help-texts";
import { CycleSteps } from "./CycleSteps";
import { COLORS } from "./ui";

export type CycleScreen = "budget" | "entry";

export function CycleStatusRow({
  period,
  refreshKey,
  onOpen,
}: {
  /** 対象月（YYYY-MM。KPI の対象月） */
  period: string;
  refreshKey: number;
  onOpen?: (screen: CycleScreen, month: string) => void;
}) {
  const [data, setData] = useState<CycleStatus | null>(null);

  useEffect(() => {
    const [year, month] = period.split("-").map(Number);
    fetchCycleStatus(year, month)
      .then(setData)
      .catch(() => setData(null));
  }, [period, refreshKey]);

  if (!data) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>予算と実績の確定</Text>
      <CycleSteps
        status={data}
        onPressBudget={onOpen && ((m) => onOpen("budget", m))}
        onPressActuals={onOpen && ((m) => onOpen("entry", m))}
      />
      <Text style={s.note}>{DASHBOARD_HELP.cycleStatus}</Text>
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
  note: { fontSize: 11, color: COLORS.muted, lineHeight: 16 },
});
