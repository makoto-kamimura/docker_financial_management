// 月（1〜12）を選ぶボタンの列（web 版 components/MonthPicker.tsx と同じ役割）。
// 年は画面上部の対象年度で決まり、ここでは月だけを選ぶ。予実差確認・予算の確定・実績の確定で使う。
import { StyleSheet, Text, View } from "react-native";
import { COLORS, Pills } from "./ui";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}月` }));

export function MonthPills({
  label,
  year,
  month,
  onChange,
}: {
  label: string;
  year: number;
  month: number | null;
  onChange: (month: number) => void;
}) {
  return (
    <View style={s.wrap}>
      <Text style={s.label}>
        {label}（{year}年）
      </Text>
      <Pills options={MONTHS} value={month} onChange={onChange} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { fontSize: 11, color: COLORS.sub, marginBottom: 4 },
});
