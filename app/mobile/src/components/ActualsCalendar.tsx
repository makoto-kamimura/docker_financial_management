// 実績管理のカレンダー（web 版 /entry の「カレンダー」タブと同じ内容）。
// 現金の明細を GET/POST/DELETE /actuals で扱う。月の収入・支出合計と日別の増減を表示し、
// 選んだ日に「収入 / 支出・摘要・科目・金額」で登録できる（出どころの「現金」）。
// 科目を付けて登録するので、登録した時点で実績になる。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteActual,
  fetchActuals,
  postActual,
  type Account,
  type CashEntry,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { digitsOnly, isoDate, yen } from "../format";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, Card, Field, Input, Notice, Pills } from "./ui";
import { CalendarTotals, DayAmounts, MonthCalendar } from "./MonthCalendar";

const INCOME_CATS = ["REVENUE", "PROFIT"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];

type Direction = "income" | "expense";
const BLANK_FORM = {
  description: "",
  accountCode: "",
  amount: "",
  direction: "expense" as Direction,
};

// 明細 1 件の収入（入金）・支出（出金）。web 版 entryAmount と同じ
function entryAmount(e: CashEntry): { income: number; expense: number } {
  return { income: Math.max(e.amount, 0), expense: Math.max(-e.amount, 0) };
}

type Props = { accounts: Account[]; viewMode: ViewMode };

export function ActualsCalendar({ accounts, viewMode }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);

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
    const m = new Map<number, CashEntry[]>();
    for (const e of entries) {
      const d = new Date(e.date).getDate();
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

  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  const mainCats = form.direction === "income" ? INCOME_CATS : EXPENSE_CATS;
  const accountLabel = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "選択してください";
  };

  async function submit() {
    if (!selectedDay) return;
    if (!form.description.trim() || !form.accountCode) {
      setError("摘要と科目を入力してください");
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
        amount: Number(form.amount),
        direction: form.direction,
      });
      setForm(BLANK_FORM);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(e: CashEntry) {
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
      <MonthCalendar
        year={year}
        month={month}
        onMove={moveMonth}
        summary={
          <CalendarTotals
            items={[
              { label: "収入合計", value: monthTotals.income, tone: "in" },
              { label: "支出合計", value: monthTotals.expense, tone: "out" },
              { label: "差引", value: monthTotals.net, tone: "net" },
            ]}
            note={`${monthTotals.count} 件の実績`}
          />
        }
        loading={loading}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        renderDay={(day) => {
          const dayEntries = byDay.get(day) ?? [];
          return (
            <DayAmounts
              income={dayEntries.reduce((sum, e) => sum + entryAmount(e).income, 0)}
              expense={dayEntries.reduce((sum, e) => sum + entryAmount(e).expense, 0)}
            />
          );
        }}
      />

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
                      {e.categoryAccount ? displayName(e.categoryAccount, viewMode) : "未割り当て"}
                    </Text>
                  </View>
                  <Text style={isIncome ? s.income : s.expense}>
                    {isIncome ? "+" : "−"}
                    {yen(isIncome ? income : expense)}
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
              <TouchableOpacity style={s.picker} onPress={() => setPicking(true)}>
                <Text style={s.pickerText} numberOfLines={1}>
                  {accountLabel(form.accountCode)}
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
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
          </Card>
        </>
      )}

      <AccountPickerModal
        visible={picking}
        accounts={accounts}
        categories={mainCats}
        title={form.direction === "expense" ? "支出科目" : "収入科目"}
        currentId={accounts.find((a) => a.code === form.accountCode)?.id ?? null}
        onSelect={(a) => {
          if (a) setForm((f) => ({ ...f, accountCode: a.code }));
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  income: { color: "#059669", fontWeight: "700" },
  expense: { color: "#e11d48", fontWeight: "700" },
  count: { fontSize: 11, color: "#94a3b8" },
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
