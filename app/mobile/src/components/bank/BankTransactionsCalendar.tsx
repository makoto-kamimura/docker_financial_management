// 銀行管理の「カレンダー」（web 版 components/BankTransactionsCalendar.tsx と同じ。形は実績管理のカレンダー
// components/ActualsCalendar.tsx に合わせる）。「表示する銀行」で選んだ口座（null はすべての口座）の明細を
// 日ごとに並べ、選んだ日の入出金の確認と、手入力での登録・削除ができる
// （GET/POST/DELETE /bank-accounts/{id}/transactions）。すべての口座のときは、登録する口座を選ぶ。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteBankTransaction,
  fetchBankTransactions,
  postBankTransaction,
  type Account,
  type BankAccount,
  type BankTransaction,
  type ViewMode,
} from "../../api";
import { categoryPayload, EntryCategoryField } from "../EntryCategoryField";
import { digitsOnly, isoDate, yen } from "../../format";
import { BANK_HELP } from "../../shared/help-texts";
import { Button, Card, Field, Input, Lead, Notice, Pills, SelectField } from "../ui";
import { CalendarTotals, DayAmounts, MonthCalendar } from "../MonthCalendar";

type Direction = "income" | "expense";
const BLANK_FORM = {
  type: "expense" as Direction,
  description: "",
  amount: "",
  /** すべての口座を表示しているときの登録先 */
  accountId: null as number | null,
  /** 科目（null = 自動） */
  category: null as Account | null,
};

type Props = {
  accounts: BankAccount[];
  /** 「表示する銀行」で選んだ口座。null はすべての口座 */
  accountId: number | null;
  /** 残高が変わったとき（口座の残高・資金繰りを取り直す） */
  onBalanceChanged: () => void;
  /** 科目の選択肢（fetchAccounts の結果） */
  categoryAccounts: Account[];
  viewMode: ViewMode;
};

export function BankTransactionsCalendar({
  accounts,
  accountId,
  onBalanceChanged,
  categoryAccounts,
  viewMode,
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const ids = accountId !== null ? [accountId] : accounts.map((a) => a.id);
    setLoading(true);
    try {
      setTxns((await Promise.all(ids.map((id) => fetchBankTransactions(id)))).flat());
    } catch {
      setTxns([]);
    } finally {
      setLoading(false);
    }
  }, [accountId, accounts]);

  useEffect(() => {
    load();
  }, [load]);

  // 表示中の月の明細を日ごとに（明細の日付は "YYYY-MM-DD..." の先頭で判定する）
  const monthPrefix = isoDate(year, month, 1).slice(0, 8);
  const byDay = useMemo(() => {
    const m = new Map<number, BankTransaction[]>();
    for (const t of txns) {
      if (!t.date.startsWith(monthPrefix)) continue;
      const d = Number(t.date.slice(8, 10));
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return m;
  }, [txns, monthPrefix]);

  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let count = 0;
    for (const list of byDay.values()) {
      for (const t of list) {
        if (t.amount > 0) income += t.amount;
        else expense += -t.amount;
        count++;
      }
    }
    return { income, expense, net: income - expense, count };
  }, [byDay]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDay(null);
  }

  const selectedTxns = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  async function submit() {
    if (!selectedDay) return;
    const target = accountId ?? form.accountId;
    if (target === null) {
      setError("登録する口座を選んでください");
      return;
    }
    const raw = Number(form.amount);
    if (!form.description.trim() || !(raw > 0)) {
      setError("摘要と金額を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await postBankTransaction(target, {
        date: isoDate(year, month, selectedDay),
        description: form.description.trim(),
        amount: form.type === "expense" ? -Math.abs(raw) : Math.abs(raw),
        ...categoryPayload(form.category),
      });
      setForm((f) => ({ ...BLANK_FORM, type: f.type, accountId: f.accountId }));
      await load();
      onBalanceChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(t: BankTransaction) {
    const message = t.transferGroupId
      ? `「${t.description}」を削除します。振替の相手の口座の明細も一緒に削除されます。よろしいですか？`
      : `「${t.description}」を削除します。よろしいですか？`;
    Alert.alert("明細を削除", message, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteBankTransaction(t.accountId, t.id);
            await load();
            onBalanceChanged();
          } catch (err) {
            Alert.alert("削除エラー", err instanceof Error ? err.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  if (accounts.length === 0) {
    return (
      <Notice tone="warn">
        口座が登録されていません。銀行の画面の「銀行口座」から口座を登録してください。
      </Notice>
    );
  }

  return (
    <View>
      <Lead>{BANK_HELP.calendar}</Lead>
      <MonthCalendar
        year={year}
        month={month}
        onMove={moveMonth}
        summary={
          <CalendarTotals
            items={[
              { label: "入金合計", value: monthTotals.income, tone: "in" },
              { label: "出金合計", value: monthTotals.expense, tone: "out" },
              { label: "差引", value: monthTotals.net, tone: "net" },
            ]}
            note={`${monthTotals.count} 件の明細`}
          />
        }
        loading={loading}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        renderDay={(day) => {
          const dayEntries = byDay.get(day) ?? [];
          return (
            <DayAmounts
              income={dayEntries.reduce((sum, t) => sum + Math.max(t.amount, 0), 0)}
              expense={dayEntries.reduce((sum, t) => sum + Math.max(-t.amount, 0), 0)}
            />
          );
        }}
      />

      {!selectedDay ? (
        <Text style={s.hint}>カレンダーの日付をタップして入出金を確認・追加してください</Text>
      ) : (
        <>
          <Card>
            <Text style={s.dayTitle}>
              {year}年{month}月{selectedDay}日
            </Text>
            <Text style={s.count}>{selectedTxns.length} 件の明細</Text>
            {selectedTxns.map((t) => (
              <View key={t.id} style={s.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.entryDesc} numberOfLines={1}>
                    {t.description}
                  </Text>
                  <Text style={s.entryAccounts} numberOfLines={1}>
                    {accountId === null &&
                      `${accounts.find((a) => a.id === t.accountId)?.name ?? ""} ・ `}
                    {t.transferGroupId
                      ? "口座間の振替"
                      : t.chargeToAccount
                        ? `チャージ: ${t.chargeToAccount.name}`
                        : t.categoryAccount
                          ? `${t.categoryAccount.code} ${t.categoryAccount.name}`
                          : "科目なし"}
                  </Text>
                </View>
                <Text style={t.amount > 0 ? s.income : s.expense}>
                  {t.amount > 0 ? "+" : "−"}
                  {yen(Math.abs(t.amount))}
                </Text>
                <TouchableOpacity onPress={() => confirmDelete(t)} hitSlop={8}>
                  <Text style={s.remove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={s.formTitle}>入出金を追加</Text>
            <Pills
              scroll={false}
              options={[
                { value: "expense" as Direction, label: "出金" },
                { value: "income" as Direction, label: "入金" },
              ]}
              value={form.type}
              onChange={(type) => setForm((f) => ({ ...f, type, category: null }))}
            />
            {/* すべての銀行を表示しているときは、登録する口座を選ぶ */}
            {accountId === null && (
              <SelectField
                label="口座"
                value={form.accountId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.name}（${a.bankName}）`,
                }))}
                onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
              />
            )}
            <Field label="摘要">
              <Input
                value={form.description}
                placeholder="例: 食料品"
                onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              />
            </Field>
            <Field label="金額（円）">
              <Input
                keyboardType="number-pad"
                value={form.amount}
                placeholder="例: 5000"
                onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
              />
            </Field>
            <EntryCategoryField
              accounts={categoryAccounts}
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              direction={form.type}
              viewMode={viewMode}
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
          </Card>
        </>
      )}
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
});
