// 月ごとの流れ「① 予算の確定 → ② 実績の確定 → ③ 翌月の予算の確定」の状況表示
// （web 版 components/CycleSteps.tsx と同じ）。予算の確定・実績の確定・ホームの状況の 1 行で共用する。
// ①③ は予算の画面、② は実績の画面で操作するので、onPress を渡すと各段を押せるようにする
// （予算の確定タブは「予算の月」で開くので、① はその月、③ は翌月を渡す）。
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { CycleStatus } from "../api";
import { cycleKey } from "../shared/cycle-month";

export const formatYmd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

export function StatusBadge({ label, confirmedAt }: { label: string; confirmedAt: string | null }) {
  return (
    <View style={[s.badge, confirmedAt ? s.badgeDone : s.badgeOpen]}>
      <Text style={[s.badgeText, confirmedAt ? s.badgeTextDone : s.badgeTextOpen]}>
        {confirmedAt ? `🔒 ${label}：確定済み` : `${label}：未確定`}
      </Text>
    </View>
  );
}

export function ActualsBadge({
  label,
  confirmedAt,
  entered,
}: {
  label: string;
  confirmedAt: string | null;
  entered: boolean;
}) {
  if (confirmedAt) return <StatusBadge label={label} confirmedAt={confirmedAt} />;
  return (
    <View style={[s.badge, entered ? s.badgeEntered : s.badgeWaiting]}>
      <Text style={[s.badgeText, entered ? s.badgeTextEntered : s.badgeTextWaiting]}>
        {entered ? `${label}：入力済み` : `${label}：入力待ち`}
      </Text>
    </View>
  );
}

function Step({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
  if (!onPress) return <>{children}</>;
  return (
    <TouchableOpacity onPress={onPress} hitSlop={4} accessibilityRole="link">
      {children}
    </TouchableOpacity>
  );
}

export function CycleSteps({
  status,
  onPressBudget,
  onPressActuals,
}: {
  status: CycleStatus;
  /** ①③ を押したとき（予算の確定へ。month はその段の予算の月 YYYY-MM） */
  onPressBudget?: (month: string) => void;
  /** ② を押したとき（実績の確定へ。month は実績の月 YYYY-MM） */
  onPressActuals?: (month: string) => void;
}) {
  const { year, month, next } = status;
  const own = cycleKey(year, month);
  const nextKey = cycleKey(next.year, next.month);
  return (
    <View style={s.badges}>
      <Step onPress={onPressBudget && (() => onPressBudget(own))}>
        <StatusBadge label={`① ${month}月の予算`} confirmedAt={status.confirmedAt} />
      </Step>
      <Step onPress={onPressActuals && (() => onPressActuals(own))}>
        <ActualsBadge
          label={`② ${month}月の実績`}
          confirmedAt={status.actuals.confirmedAt}
          entered={status.actuals.entered}
        />
      </Step>
      <Step onPress={onPressBudget && (() => onPressBudget(nextKey))}>
        <StatusBadge label={`③ ${next.month}月の予算`} confirmedAt={status.nextConfirmedAt} />
      </Step>
    </View>
  );
}

const s = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeDone: { backgroundColor: "#ecfdf5" },
  badgeOpen: { backgroundColor: "#f1f5f9" },
  badgeText: { fontSize: 11 },
  badgeTextDone: { color: "#047857" },
  badgeTextOpen: { color: "#475569" },
  badgeEntered: { backgroundColor: "#f0f9ff" },
  badgeWaiting: { backgroundColor: "#fffbeb" },
  badgeTextEntered: { color: "#0369a1" },
  badgeTextWaiting: { color: "#b45309" },
});
