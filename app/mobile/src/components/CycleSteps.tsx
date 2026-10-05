// 月ごとの流れ「① 予算の確定 → ② 実績の確定 → ③ 翌月の予算の確定」の状況表示
// （web 版 components/CycleSteps.tsx と同じ）。予算の確定・実績の確定・ホームの状況の 1 行で共用する。
// ①③ は予算の画面、② は実績の画面で操作するので、onPress を渡すと各段を押せるようにする。
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { CycleStatus } from "../api";

// 実績の月が締まるのは翌月なので、既定は前月（前月の実績を確定し、今月の予算を確定する）
export function defaultCycleMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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
  /** ①③ を押したとき（予算の確定へ） */
  onPressBudget?: () => void;
  /** ② を押したとき（実績の確定へ） */
  onPressActuals?: () => void;
}) {
  const { month, next } = status;
  return (
    <View style={s.badges}>
      <Step onPress={onPressBudget}>
        <StatusBadge label={`① ${month}月の予算`} confirmedAt={status.confirmedAt} />
      </Step>
      <Step onPress={onPressActuals}>
        <ActualsBadge
          label={`② ${month}月の実績`}
          confirmedAt={status.actuals.confirmedAt}
          entered={status.actuals.entered}
        />
      </Step>
      <Step onPress={onPressBudget}>
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
