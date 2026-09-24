// 実績管理のカレンダー（web 版 /entry の「カレンダー」タブと同じ内容）。
// 日付ごとの入出金（仕訳）を GET/POST/DELETE /actuals で扱う。月の収入・支出合計と日別の増減を表示し、
// 選んだ日に「収入 / 支出・摘要・科目・入出金口座・金額・支払方法」で登録できる。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteActual,
  fetchActuals,
  postActual,
  type Account,
  type ActualEntry,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { digitsOnly, isoDate, yenJa } from "../format";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, Card, Field, Input, Notice, Pills } from "./ui";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const PAY_METHODS = [
  { value: "cash", label: "現金" },
  { value: "bank", label: "銀行" },
  { value: "card", label: "カード" },
  { value: "transfer", label: "振込" },
];
const INCOME_CATS = ["REVENUE", "PROFIT"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];
const ASSET_CATS = ["ASSET"];

type Direction = "income" | "expense";
const BLANK_FORM = {
  description: "",
  accountCode: "",
  counterAccountCode: "",
  amount: "",
  direction: "expense" as Direction,
  paymentMethod: "cash",
};

// 仕訳 1 件の収入（収入科目の貸方）・支出（費用科目の借方）。web 版 entryAmount と同じ
function entryAmount(e: ActualEntry): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const d of e.details) {
    const amt = Number(d.amount);
    if (INCOME_CATS.includes(d.account.category) && d.side === "credit") income += amt;
    if (EXPENSE_CATS.includes(d.account.category) && d.side === "debit") expense += amt;
  }
  return { income, expense };
}

type Props = { accounts: Account[]; viewMode: ViewMode };

export function ActualsCalendar({ accounts, viewMode }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [entries, setEntries] = useState<ActualEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<"account" | "counter" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await fetchActuals(year, month));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<number, ActualEntry[]>();
    for (const e of entries) {
      const d = new Date(e.transactionDate).getDate();
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return m;
  }, [entries]);

  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of entries) {
      const a = entryAmount(e);
      income += a.income;
      expense += a.expense;
    }
    return { income, expense, net: income - expense, count: entries.length };
  }, [entries]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDay(null);
  }

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  const mainCats = form.direction === "income" ? INCOME_CATS : EXPENSE_CATS;
  const accountLabel = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "選択してください";
  };

  async function submit() {
    if (!selectedDay) return;
    if (!form.description.trim() || !form.accountCode || !form.counterAccountCode) {
      setError("摘要・科目・口座を入力してください");
      return;
    }
    if (!(Number(form.amount) > 0)) {
      setError("金額は 1 円以上で入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await postActual({
        date: isoDate(year, month, selectedDay),
        description: form.description.trim(),
        accountCode: form.accountCode,
        counterAccountCode: form.counterAccountCode,
        amount: Number(form.amount),
        direction: form.direction,
        paymentMethod: form.paymentMethod,
      });
      setForm(BLANK_FORM);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(e: ActualEntry) {
    Alert.alert("実績を削除", `「${e.description}」を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteActual(e.id);
            await load();
          } catch (err) {
            Alert.alert("削除エラー", err instanceof Error ? err.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  return (
    <View>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <View style={s.monthNav}>
          <TouchableOpacity onPress={() => moveMonth(-1)} style={s.navBtn}>
            <Text style={s.navTxt}>◀</Text>
          </TouchableOpacity>
          <Text style={s.monthLabel}>
            {year}年{month}月
          </Text>
          <TouchableOpacity onPress={() => moveMonth(1)} style={s.navBtn}>
            <Text style={s.navTxt}>▶</Text>
          </TouchableOpacity>
        </View>
        {/* 当月に入力された実績の合計 */}
        <View style={s.totals}>
          <Text style={s.totalItem}>
            収入合計 <Text style={s.income}>{yenJa(monthTotals.income)}</Text>
          </Text>
          <Text style={s.totalItem}>
            支出合計 <Text style={s.expense}>{yenJa(monthTotals.expense)}</Text>
          </Text>
          <Text style={s.totalItem}>
            差引{" "}
            <Text style={monthTotals.net < 0 ? s.expense : s.net}>{yenJa(monthTotals.net)}</Text>
          </Text>
          <Text style={s.count}>{monthTotals.count} 件の実績</Text>
        </View>
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
              const valid = day >= 1 && day <= daysInMonth;
              if (!valid) return <View key={i} style={[s.dayCell, s.dayBlank]} />;
              const dayEntries = byDay.get(day) ?? [];
              const inc = dayEntries.reduce((sum, e) => sum + entryAmount(e).income, 0);
              const exp = dayEntries.reduce((sum, e) => sum + entryAmount(e).expense, 0);
              const isToday =
                year === today.getFullYear() &&
                month === today.getMonth() + 1 &&
                day === today.getDate();
              const weekday = i % 7;
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.dayCell, day === selectedDay && s.daySelected]}
                  onPress={() => setSelectedDay(day)}
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
                  {inc > 0 && (
                    <Text style={s.dayIncome} numberOfLines={1}>
                      +{Math.round(inc).toLocaleString("ja-JP")}
                    </Text>
                  )}
                  {exp > 0 && (
                    <Text style={s.dayExpense} numberOfLines={1}>
                      −{Math.round(exp).toLocaleString("ja-JP")}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Card>

      {!selectedDay ? (
        <Text style={s.hint}>カレンダーの日付をタップして実績を入力してください</Text>
      ) : (
        <>
          <Card>
            <Text style={s.dayTitle}>
              {year}年{month}月{selectedDay}日
            </Text>
            <Text style={s.count}>{selectedEntries.length} 件の実績</Text>
            {selectedEntries.map((e) => {
              const { income, expense } = entryAmount(e);
              const isIncome = income > 0;
              return (
                <View key={e.id} style={s.entryRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.entryDesc} numberOfLines={1}>
                      {e.description}
                    </Text>
                    <Text style={s.entryAccounts} numberOfLines={1}>
                      {e.details.map((d) => displayName(d.account, viewMode)).join(" / ")}
                    </Text>
                  </View>
                  <Text style={isIncome ? s.income : s.expense}>
                    {isIncome ? "+" : "−"}
                    {yenJa(isIncome ? income : expense)}
                  </Text>
                  <TouchableOpacity onPress={() => confirmDelete(e)} hitSlop={8}>
                    <Text style={s.remove}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </Card>

          <Card>
            <Text style={s.formTitle}>実績を追加</Text>
            <Pills
              scroll={false}
              options={[
                { value: "expense" as Direction, label: "支出" },
                { value: "income" as Direction, label: "収入" },
              ]}
              value={form.direction}
              onChange={(d) => setForm((f) => ({ ...f, direction: d, accountCode: "" }))}
            />
            <Field label="摘要">
              <Input
                value={form.description}
                placeholder="例: 食料品"
                onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              />
            </Field>
            <Field label={form.direction === "expense" ? "支出科目" : "収入科目"}>
              <TouchableOpacity style={s.picker} onPress={() => setPicking("account")}>
                <Text style={s.pickerText} numberOfLines={1}>
                  {accountLabel(form.accountCode)}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label={form.direction === "expense" ? "支払元口座" : "入金先口座"}>
              <TouchableOpacity style={s.picker} onPress={() => setPicking("counter")}>
                <Text style={s.pickerText} numberOfLines={1}>
                  {accountLabel(form.counterAccountCode)}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label="金額（円）">
              <Input
                keyboardType="number-pad"
                value={form.amount}
                placeholder="例: 5000"
                onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
              />
            </Field>
            <Field label="支払方法">
              <Pills
                scroll={false}
                options={PAY_METHODS}
                value={form.paymentMethod}
                onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
              />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
          </Card>
        </>
      )}

      <AccountPickerModal
        visible={picking !== null}
        accounts={accounts}
        categories={picking === "counter" ? ASSET_CATS : mainCats}
        title={
          picking === "counter"
            ? form.direction === "expense"
              ? "支払元口座"
              : "入金先口座"
            : form.direction === "expense"
              ? "支出科目"
              : "収入科目"
        }
        currentId={
          accounts.find(
            (a) => a.code === (picking === "counter" ? form.counterAccountCode : form.accountCode),
          )?.id ?? null
        }
        onSelect={(a) => {
          if (a)
            setForm((f) =>
              picking === "counter"
                ? { ...f, counterAccountCode: a.code }
                : { ...f, accountCode: a.code },
            );
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
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
  hint: { textAlign: "center", color: "#94a3b8", fontSize: 13, paddingVertical: 16 },
  dayTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    marginTop: 6,
  },
  entryDesc: { fontSize: 13, color: "#1e293b", fontWeight: "500" },
  entryAccounts: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  remove: { fontSize: 13, color: "#cbd5e1", paddingHorizontal: 4 },
  formTitle: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8 },
  picker: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
});
