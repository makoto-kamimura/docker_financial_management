// カード・電子マネーのカレンダー（日ごとの利用・返金の合計と、その日の明細・支払いの追加）。
// カード・電子マネー管理から、実績の画面の「カレンダー」（出どころにカード・電子マネーを選んだとき）へ移した。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import { displayName } from "../../shared/display-name";
import { digitsOnly, isoDate, yen } from "../../format";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

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
  const [form, setForm] = useState({
    description: "",
    amount: "",
    type: "charge" as "charge" | "refund",
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

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
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
      });
      setForm({ description: "", amount: "", type: "charge" });
      setMsg(null);
      await load();
    } catch {
      setMsg("登録に失敗しました");
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
        <View style={s.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <Text key={w} style={[s.weekCell, i === 0 && s.sun, i === 6 && s.sat]}>
              {w}
            </Text>
          ))}
        </View>
        {txns === null ? (
          <ActivityIndicator color="#4f46e5" style={{ marginVertical: 32 }} />
        ) : (
          <View style={s.grid}>
            {Array.from({ length: totalCells }, (_, i) => {
              const day = i - firstWeekday + 1;
              if (day < 1 || day > daysInMonth) return <View key={i} style={[s.cell, s.blank]} />;
              const list = byDay.get(day) ?? [];
              const charge = list.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
              const refund = list.filter((t) => t.amount < 0).reduce((sum, t) => sum - t.amount, 0);
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.cell, day === selectedDay && s.cellSelected]}
                  onPress={() => setSelectedDay(day)}
                >
                  <Text style={[s.dayNum, i % 7 === 0 && s.sun, i % 7 === 6 && s.sat]}>{day}</Text>
                  {charge > 0 && (
                    <Text style={s.charge} numberOfLines={1}>
                      {Math.round(charge).toLocaleString("ja-JP")}
                    </Text>
                  )}
                  {refund > 0 && (
                    <Text style={s.refund} numberOfLines={1}>
                      −{Math.round(refund).toLocaleString("ja-JP")}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Card>

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
            <Button label={saving ? "登録中..." : "登録"} onPress={submit} loading={saving} />
          </Card>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, paddingBottom: 32 },
  cardActions: { flexDirection: "row", gap: 16, marginBottom: 10, marginTop: -4 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16 },
  warn: { fontSize: 11, color: "#b45309", lineHeight: 16, marginTop: 4 },
  picker: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
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
  weekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  weekCell: { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", paddingVertical: 6 },
  sun: { color: "#ef4444" },
  sat: { color: "#3b82f6" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    minHeight: 56,
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  cellSelected: { backgroundColor: "#eef2ff" },
  blank: { backgroundColor: "#fafafa" },
  dayNum: { fontSize: 12, fontWeight: "600", color: "#334155" },
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
