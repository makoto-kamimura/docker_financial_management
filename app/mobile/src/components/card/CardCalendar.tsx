// カード・電子マネーのカレンダー（日ごとの利用・返金の合計と、その日の明細・支払いの追加）。
// カード・電子マネー管理から、実績の画面の「カレンダー」（出どころにカード・電子マネーを選んだとき）へ移した。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteCardTransaction,
  fetchCardTransactions,
  postCardTransaction,
  type Account,
  type CardTransaction,
  type LinkedAccount,
  type ViewMode,
} from "../../api";
import { Button, Card, EmptyText, Field, Input, Notice, Pills } from "../ui";
import { categoryPayload, EntryCategoryField } from "../EntryCategoryField";
import { displayName } from "../../shared/display-name";
import { digitsOnly, isoDate, yen } from "../../format";
import { DayAmounts, MonthCalendar } from "../MonthCalendar";

export function CardCalendar({
  account,
  viewMode,
  categoryAccounts,
}: {
  account: LinkedAccount;
  viewMode: ViewMode;
  categoryAccounts: Account[];
}) {
  const now = new Date();
  const isEMoney = account.type === "E_MONEY";
  const [txns, setTxns] = useState<CardTransaction[] | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  // category は科目（null = 自動。学習ルールで決め、無ければ未割り当て）
  const [form, setForm] = useState({
    description: "",
    amount: "",
    type: "charge" as "charge" | "refund",
    category: null as Account | null,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTxns(await fetchCardTransactions(account.id));
    } catch {
      setTxns([]);
    }
  }, [account.id]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<number, CardTransaction[]>();
    for (const t of txns ?? []) {
      const d = new Date(t.date);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
      m.set(d.getDate(), [...(m.get(d.getDate()) ?? []), t]);
    }
    return m;
  }, [txns, year, month]);

  const entries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDay(null);
  }

  async function submit() {
    if (!selectedDay) return;
    const raw = Number(form.amount);
    if (!form.description.trim() || !(raw > 0)) return setMsg("摘要と金額を入力してください");
    setSaving(true);
    try {
      await postCardTransaction(account.id, {
        date: isoDate(year, month, selectedDay),
        description: form.description.trim(),
        amount: form.type === "charge" ? Math.abs(raw) : -Math.abs(raw),
        ...categoryPayload(form.category),
      });
      setForm({ description: "", amount: "", type: "charge", category: null });
      setMsg(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function remove(t: CardTransaction) {
    Alert.alert("明細を削除", `「${t.description}」を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          await deleteCardTransaction(account.id, t.id).catch(() => setMsg("削除に失敗しました"));
          await load();
        },
      },
    ]);
  }

  const categoryName = (t: CardTransaction) => {
    if (!t.categoryAccount) return null;
    const a = categoryAccounts.find((x) => x.id === t.categoryAccount!.id);
    return `${t.categoryAccount.code} ${a ? displayName(a, viewMode) : t.categoryAccount.name}`;
  };

  return (
    <View>
      {msg && <Notice tone="error">{msg}</Notice>}
      <MonthCalendar
        year={year}
        month={month}
        onMove={moveMonth}
        loading={txns === null}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        renderDay={(day) => {
          const dayEntries = byDay.get(day) ?? [];
          return (
            <DayAmounts
              income={dayEntries.filter((t) => t.amount < 0).reduce((sum, t) => sum - t.amount, 0)}
              expense={dayEntries.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0)}
            />
          );
        }}
      />

      {selectedDay === null ? (
        <EmptyText>カレンダーの日付をタップして支払いを入力してください</EmptyText>
      ) : (
        <>
          <Card>
            <Text style={s.dayTitle}>
              {year}年{month}月{selectedDay}日
            </Text>
            <Text style={s.muted}>{entries.length} 件の明細</Text>
            {entries.map((t) => (
              <View key={t.id} style={s.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.entryDesc} numberOfLines={1}>
                    {t.description}
                  </Text>
                  {categoryName(t) && <Text style={s.muted}>{categoryName(t)}</Text>}
                </View>
                <Text style={t.amount > 0 ? s.charge : s.refund}>{yen(t.amount)}</Text>
                <TouchableOpacity onPress={() => remove(t)} hitSlop={8}>
                  <Text style={s.remove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>
          <Card>
            <Text style={s.formTitle}>支払いを追加</Text>
            <Pills
              scroll={false}
              options={[
                { value: "charge" as const, label: "利用" },
                { value: "refund" as const, label: "返金" },
              ]}
              value={form.type}
              onChange={(type) => setForm((f) => ({ ...f, type }))}
            />
            <Field label="摘要（利用先）">
              <Input
                value={form.description}
                placeholder={isEMoney ? "例: セブン-イレブン（Suica）" : "例: AMAZON.CO.JP"}
                onChangeText={(description) => setForm((f) => ({ ...f, description }))}
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
            {/* 利用は支出の科目、返金は支出の科目のマイナスとして実績に入る */}
            <EntryCategoryField
              accounts={categoryAccounts}
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              direction="expense"
              viewMode={viewMode}
            />
            <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
          </Card>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16 },
  charge: { fontSize: 9, color: "#dc2626" },
  refund: { fontSize: 9, color: "#059669" },
  dayTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  entryDesc: { fontSize: 13, color: "#1e293b" },
  remove: { fontSize: 13, color: "#cbd5e1", paddingHorizontal: 4 },
  formTitle: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8 },
});
