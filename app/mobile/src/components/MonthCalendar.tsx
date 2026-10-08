// 月のカレンダー（予算・現金・銀行・カードのカレンダーで共用。web 版 components/MonthCalendar.tsx と同じ）。
// 月の移動・月の合計の帯・曜日の行・日のマス（今日の印・選んだ日の強調・土日の色）をここにまとめ、
// マスの中身（その日の収入・支出など）と、選んだ日の一覧・登録フォームは呼び出し側が持つ。
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { amountText, yen } from "../format";
import { Card } from "./ui";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 月の 1 日の曜日・日数・マスの数 */
export function monthGrid(year: number, month: number) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return { firstWeekday, daysInMonth, totalCells };
}

/** year・month を delta か月動かした年月 */
export function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function MonthCalendar({
  year,
  month,
  onMove,
  titleExtra,
  summary,
  loading = false,
  selectedDay,
  onSelectDay,
  renderDay,
}: {
  year: number;
  month: number;
  /** 前月（-1）・翌月（+1）へ */
  onMove: (delta: -1 | 1) => void;
  /** 年月の横に出す印（「確定済み」など） */
  titleExtra?: string;
  /** 年月の下に出す月の合計の帯（CalendarTotals） */
  summary?: ReactNode;
  loading?: boolean;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
  /** 日のマスの中身（日付の下に出す） */
  renderDay?: (day: number) => ReactNode;
}) {
  const today = new Date();
  const { firstWeekday, daysInMonth, totalCells } = monthGrid(year, month);
  const isThisMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <View style={s.monthNav}>
        <TouchableOpacity onPress={() => onMove(-1)} style={s.navBtn} accessibilityLabel="前の月">
          <Text style={s.navTxt}>◀</Text>
        </TouchableOpacity>
        <Text style={s.monthLabel}>
          {year}年{month}月{titleExtra ? ` ${titleExtra}` : ""}
        </Text>
        <TouchableOpacity onPress={() => onMove(1)} style={s.navBtn} accessibilityLabel="次の月">
          <Text style={s.navTxt}>▶</Text>
        </TouchableOpacity>
      </View>
      {summary}
      <View style={s.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={w} style={[s.weekCell, i === 0 && s.sun, i === 6 && s.sat]}>
            {w}
          </Text>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color="#4f46e5" style={{ marginVertical: 32 }} />
      ) : (
        <View style={s.grid}>
          {Array.from({ length: totalCells }, (_, i) => {
            const day = i - firstWeekday + 1;
            if (day < 1 || day > daysInMonth) {
              return <View key={i} style={[s.dayCell, s.dayBlank]} />;
            }
            const weekday = i % 7;
            const isToday = isThisMonth && day === today.getDate();
            return (
              <TouchableOpacity
                key={i}
                style={[s.dayCell, day === selectedDay && s.daySelected]}
                onPress={() => onSelectDay(day)}
                accessibilityLabel={`${month}月${day}日`}
              >
                <Text
                  style={[
                    s.dayNum,
                    weekday === 0 && s.sun,
                    weekday === 6 && s.sat,
                    isToday && s.today,
                  ]}
                >
                  {day}
                </Text>
                {renderDay?.(day)}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </Card>
  );
}

/** 月の合計の帯（収入・支出・差引など）。tone: in は緑、out は赤、net は差引（負なら赤） */
export function CalendarTotals({
  items,
  note,
}: {
  items: { label: string; value: number; tone: "in" | "out" | "net" }[];
  /** 件数など */
  note?: string;
}) {
  return (
    <View style={s.totals}>
      {items.map((it) => (
        <Text key={it.label} style={s.totalItem}>
          {it.label}{" "}
          <Text
            style={
              it.tone === "in"
                ? s.income
                : it.tone === "out"
                  ? s.expense
                  : it.value < 0
                    ? s.expense
                    : s.net
            }
          >
            {yen(it.value)}
          </Text>
        </Text>
      ))}
      {note ? <Text style={s.count}>{note}</Text> : null}
    </View>
  );
}

/** マスの中の、その日の入金（+）と出金（−）の合計。幅が狭いので数字だけ出す */
export function DayAmounts({ income, expense }: { income: number; expense: number }) {
  return (
    <>
      {income > 0 && (
        <Text style={s.dayIncome} numberOfLines={1}>
          +{amountText(income)}
        </Text>
      )}
      {expense > 0 && (
        <Text style={s.dayExpense} numberOfLines={1}>
          −{amountText(expense)}
        </Text>
      )}
    </>
  );
}

const s = StyleSheet.create({
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  navBtn: { padding: 8 },
  navTxt: { fontSize: 14, color: "#4f46e5" },
  monthLabel: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  totals: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  totalItem: { fontSize: 11, color: "#64748b" },
  income: { color: "#059669", fontWeight: "700" },
  expense: { color: "#e11d48", fontWeight: "700" },
  net: { color: "#4f46e5", fontWeight: "700" },
  count: { fontSize: 11, color: "#94a3b8" },
  weekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  weekCell: { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", paddingVertical: 6 },
  sun: { color: "#ef4444" },
  sat: { color: "#3b82f6" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    minHeight: 58,
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  dayBlank: { backgroundColor: "#fafafa" },
  daySelected: { backgroundColor: "#eef2ff" },
  dayNum: { fontSize: 12, fontWeight: "600", color: "#334155" },
  today: {
    color: "#fff",
    backgroundColor: "#4f46e5",
    borderRadius: 9,
    width: 18,
    textAlign: "center",
    overflow: "hidden",
  },
  dayIncome: { fontSize: 8, color: "#059669" },
  dayExpense: { fontSize: 8, color: "#e11d48" },
});
