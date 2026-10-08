// 予算管理の「カレンダー」（web 版 components/BudgetCalendar.tsx と同じ。形は実績のカレンダー
// components/ActualsCalendar.tsx に合わせる）。日付を選んで予算を登録すると、その科目・月の予算に足され、
// 一覧のセルの内訳に出る（GET/POST/DELETE /budget-items）。予算を確定した月は登録・削除できない。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteBudgetItem,
  fetchBudgetItems,
  postBudgetItem,
  type Account,
  type BudgetItemRow,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { BUDGET_HELP } from "../shared/help-texts";
import { digitsOnly, isoDate, yen } from "../format";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, Card, Field, Input, Lead, Notice, Pills } from "./ui";
import { CalendarTotals, DayAmounts, MonthCalendar } from "./MonthCalendar";

const INCOME_CATS = ["REVENUE"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];
type Direction = "income" | "expense";
const BLANK_FORM = {
  direction: "expense" as Direction,
  description: "",
  accountCode: "",
  amount: "",
};

type Props = {
  accounts: Account[];
  viewMode: ViewMode;
  /** 一覧の年度と、その年度で予算を確定済みの月 */
  year: number;
  confirmedMonths: number[];
  /** 登録・削除のあと（一覧の金額を取り直す） */
  onChanged: () => void;
};

export function BudgetCalendar({
  accounts,
  viewMode,
  year: pageYear,
  confirmedMonths,
  onChanged,
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(pageYear);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [items, setItems] = useState<BudgetItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  // 確定済みかどうかは一覧の年度の分だけ分かる（別の年は登録時にサーバーが 409 を返す）
  const locked = year === pageYear && confirmedMonths.includes(month);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchBudgetItems(year, month));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const isIncome = (i: BudgetItemRow) => INCOME_CATS.includes(i.account.category);
  const byDay = useMemo(() => {
    const m = new Map<number, BudgetItemRow[]>();
    for (const i of items) {
      const d = Number(i.date.slice(8, 10));
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return m;
  }, [items]);
  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const i of items) {
      if (isIncome(i)) income += i.amount;
      else expense += i.amount;
    }
    return { income, expense, net: income - expense, count: items.length };
  }, [items]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDay(null);
  }

  const selectedItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const accountLabel = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "選択してください";
  };

  async function submit() {
    if (!selectedDay) return;
    if (!form.description.trim() || !form.accountCode || !(Number(form.amount) > 0)) {
      setError("摘要・科目・金額を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await postBudgetItem({
        date: isoDate(year, month, selectedDay),
        accountCode: form.accountCode,
        description: form.description.trim(),
        amount: Number(form.amount),
      });
      setForm((f) => ({ ...BLANK_FORM, direction: f.direction, accountCode: f.accountCode }));
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(i: BudgetItemRow) {
    Alert.alert(
      "予算を削除",
      `「${i.description}」を削除し、この月の予算から ${yen(i.amount)} を引きます。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteBudgetItem(i.id);
              await load();
              onChanged();
            } catch (err) {
              Alert.alert("削除エラー", err instanceof Error ? err.message : "削除に失敗しました");
            }
          },
        },
      ],
    );
  }

  return (
    <View>
      <Lead>{BUDGET_HELP.calendar}</Lead>
      <MonthCalendar
        year={year}
        month={month}
        onMove={moveMonth}
        titleExtra={locked ? "🔒" : undefined}
        summary={
          <CalendarTotals
            items={[
              { label: "収入合計", value: monthTotals.income, tone: "in" },
              { label: "支出合計", value: monthTotals.expense, tone: "out" },
              { label: "差引", value: monthTotals.net, tone: "net" },
            ]}
            note={`${monthTotals.count} 件の予算`}
          />
        }
        loading={loading}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        renderDay={(day) => {
          const dayEntries = byDay.get(day) ?? [];
          return (
            <DayAmounts
              income={dayEntries.filter(isIncome).reduce((sum, x) => sum + x.amount, 0)}
              expense={dayEntries.filter((x) => !isIncome(x)).reduce((sum, x) => sum + x.amount, 0)}
            />
          );
        }}
      />

      {!selectedDay ? (
        <Text style={s.hint}>カレンダーの日付をタップして予算を入力してください</Text>
      ) : (
        <>
          <Card>
            <Text style={s.dayTitle}>
              {year}年{month}月{selectedDay}日
            </Text>
            <Text style={s.count}>{selectedItems.length} 件の予算</Text>
            {selectedItems.map((i) => (
              <View key={i.id} style={s.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.entryDesc} numberOfLines={1}>
                    {i.description}
                  </Text>
                  <Text style={s.entryAccounts} numberOfLines={1}>
                    {accountLabel(i.account.code)}
                  </Text>
                </View>
                <Text style={isIncome(i) ? s.income : s.expense}>
                  {isIncome(i) ? "+" : "−"}
                  {yen(i.amount)}
                </Text>
                {!locked && (
                  <TouchableOpacity onPress={() => confirmDelete(i)} hitSlop={8}>
                    <Text style={s.remove}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </Card>

          {locked ? (
            <Notice tone="info">{BUDGET_HELP.cycleLocked}</Notice>
          ) : (
            <Card>
              <Text style={s.formTitle}>予算を追加</Text>
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
                  placeholder="例: 旅行"
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
                  placeholder="例: 50000"
                  onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
                />
              </Field>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
            </Card>
          )}
        </>
      )}

      <AccountPickerModal
        visible={picking}
        accounts={accounts}
        categories={form.direction === "income" ? INCOME_CATS : EXPENSE_CATS}
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
