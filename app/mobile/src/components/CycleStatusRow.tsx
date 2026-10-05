// ホームの「予算と実績の確定」の状況（web 版 components/CycleStatusStrip.tsx と同じ）。
// 前月の ① 予算 → ② 実績 → ③ 翌月の予算 の確定状況を出し、押すと予算・実績の画面の確定タブへ移る。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fetchCycleStatus, type CycleStatus } from "../api";
import { DASHBOARD_HELP } from "../shared/help-texts";
import { CycleSteps, defaultCycleMonth } from "./CycleSteps";
import { COLORS } from "./ui";

export type CycleScreen = "budget" | "entry";

export function CycleStatusRow({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen?: (screen: CycleScreen, month: string) => void;
}) {
  const target = defaultCycleMonth();
  const [data, setData] = useState<CycleStatus | null>(null);

  useEffect(() => {
    const [year, month] = target.split("-").map(Number);
    fetchCycleStatus(year, month)
      .then(setData)
      .catch(() => setData(null));
  }, [target, refreshKey]);

  if (!data) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>予算と実績の確定</Text>
      <CycleSteps
        status={data}
        onPressBudget={onOpen && (() => onOpen("budget", target))}
        onPressActuals={onOpen && (() => onOpen("entry", target))}
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
