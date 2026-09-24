// カード・電子マネー管理（web 版 /card-transactions と同じ「サマリ / 明細一覧 / カレンダー」。CSV 取込は web 版のみ）。
// クレジット・デビット・プリペイド・電子マネーは明細の構造が同じなので同じ画面で扱う。
// 銀行口座を起点にする引き落としの登録は銀行管理側の役割で、ここではチャージ先の指定と固定決済の登録を行う。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  deleteCardTransaction,
  deleteLinkedAccount,
  fetchAccounts,
  fetchCardTransactions,
  fetchLinkedAccounts,
  patchLinkedAccount,
  postCardTransaction,
  postLinkedAccount,
  type Account,
  type CardTransaction,
  type LinkedAccount,
  type ViewMode,
} from "../api";
import { CardSummary } from "../components/card/CardSummary";
import { CardTransactionsList } from "../components/card/CardTransactionsList";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Notice,
  Pills,
  SelectField,
  SheetModal,
  TabBar,
} from "../components/ui";
import { displayName } from "../shared/display-name";
import { digitsOnly, isoDate, yen } from "../format";
import {
  isChargeableType,
  LINKED_ACCOUNT_TYPE_LABELS,
  LINKED_ACCOUNT_TYPES,
} from "../shared/linked-account-type";

type Tab = "summary" | "list" | "calendar";
const TABS = [
  ["summary", "サマリ"],
  ["list", "明細一覧"],
  ["calendar", "カレンダー"],
] as const;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const LEDGER_CATEGORIES = ["ASSET", "LIABILITY"] as const;

type CardForm = {
  id: number | null; // null = 新規
  name: string;
  type: LinkedAccount["type"];
  institution: string;
  lastFour: string;
  accountCode: string;
  note: string;
};
const BLANK_CARD: CardForm = {
  id: null,
  name: "",
  type: "CREDIT_CARD",
  institution: "",
  lastFour: "",
  accountCode: "",
  note: "",
};

const NAME_PLACEHOLDER: Record<string, string> = {
  E_MONEY: "例: モバイルSuica",
  PREPAID_CARD: "例: JAL Global Wallet",
  DEBIT_CARD: "例: 住信SBIデビット",
  CREDIT_CARD: "例: 楽天カード",
};

type Props = { viewMode: ViewMode };

export function CardTransactionsScreen({ viewMode }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [categoryAccounts, setCategoryAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CardForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickingLedger, setPickingLedger] = useState(false);
  // 明細・フロー図を取り直すためのキー（プルで再読み込み・チャージ／固定決済の変更時）
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, cats] = await Promise.all([fetchLinkedAccounts(), fetchAccounts()]);
      setAccounts(list);
      setCategoryAccounts(cats);
      setAccountId((id) =>
        id !== null && list.some((a) => a.id === id) ? id : (list[0]?.id ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setReloadKey((k) => k + 1);
    setRefreshing(false);
  }

  const selected = accounts.find((a) => a.id === accountId) ?? null;
  const editingChargeSourceCount =
    form?.id != null ? (accounts.find((a) => a.id === form.id)?.chargeSourceCount ?? 0) : 0;

  async function saveCard() {
    if (!form) return;
    const doSave = async () => {
      setFormError(null);
      // 空文字は「未設定に戻す」意味を持たせたいので、編集時のみそのまま送る
      const body = {
        name: form.name,
        institution: form.institution,
        type: form.type,
        lastFour: form.lastFour || form.id !== null ? form.lastFour : undefined,
        accountCode: form.accountCode || form.id !== null ? form.accountCode : undefined,
        note: form.note || form.id !== null ? form.note : undefined,
      };
      try {
        if (form.id === null) {
          const created = await postLinkedAccount(body);
          setAccountId(created.id);
        } else {
          await patchLinkedAccount(form.id, body);
        }
        setForm(null);
        await load();
        setReloadKey((k) => k + 1);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "保存に失敗しました");
      }
    };
    // チャージ先に選べない種別へ戻すときは、取り残される指定の件数を示して確認する
    if (form.id !== null && !isChargeableType(form.type) && editingChargeSourceCount > 0) {
      Alert.alert(
        "種別の変更",
        `このカードをチャージ先に指定している明細が ${editingChargeSourceCount} 件あります。` +
          `${LINKED_ACCOUNT_TYPE_LABELS[form.type]} に変更すると、以後このカードはチャージ先に選べなくなります（既存の指定はそのまま残ります）。変更してよいですか？`,
        [
          { text: "キャンセル", style: "cancel" },
          { text: "変更する", onPress: doSave },
        ],
      );
      return;
    }
    await doSave();
  }

  function confirmDeleteCard(a: LinkedAccount) {
    Alert.alert("削除", `「${a.name}」を削除してよいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteLinkedAccount(a.id);
            await load();
          } catch (e) {
            Alert.alert("削除エラー", e instanceof Error ? e.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  const ledgerLabel = (code: string) => {
    const a = categoryAccounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "なし";
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#4f46e5" size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Button
          label="カード・電子マネー追加"
          onPress={() => {
            setFormError(null);
            setForm(BLANK_CARD);
          }}
          style={{ marginBottom: 10 }}
        />
        {accounts.length === 0 && (
          <Notice tone="warn">
            カード・電子マネーが登録されていません。利用明細を記録するには、先に登録してください。
          </Notice>
        )}

        {/* 表示対象（サマリは全カードを 1 枚に描くので出さない。web 版と同じ） */}
        {tab !== "summary" && selected && (
          <View>
            <SelectField
              label="表示対象のカード・電子マネー"
              value={accountId}
              options={accounts.map((a) => ({
                value: a.id,
                label: `[${LINKED_ACCOUNT_TYPE_LABELS[a.type] ?? "カード"}] ${a.name}`,
                sub: `${a.institution}${a.lastFour ? ` ****${a.lastFour}` : ""}`,
              }))}
              onChange={setAccountId}
            />
            <View style={s.cardActions}>
              <TouchableOpacity
                onPress={() => {
                  setFormError(null);
                  setForm({
                    id: selected.id,
                    name: selected.name,
                    type: selected.type,
                    institution: selected.institution,
                    lastFour: selected.lastFour ?? "",
                    accountCode: selected.account?.code ?? "",
                    note: selected.note ?? "",
                  });
                }}
              >
                <Text style={s.link}>編集</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDeleteCard(selected)}>
                <Text style={s.danger}>削除</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {tab === "summary" && <CardSummary accounts={accounts} reloadKey={reloadKey} />}
        {tab === "list" && selected && (
          <CardTransactionsList
            key={`${selected.id}:${reloadKey}`}
            account={selected}
            accounts={accounts}
            categoryAccounts={categoryAccounts}
            viewMode={viewMode}
            onFlowChanged={() => load()}
          />
        )}
        {tab === "calendar" && selected && (
          <CardCalendar
            key={`${selected.id}:${reloadKey}`}
            account={selected}
            viewMode={viewMode}
            categoryAccounts={categoryAccounts}
          />
        )}
      </ScrollView>

      {/* カード・電子マネーの登録／編集 */}
      <SheetModal
        visible={form !== null}
        title={form?.id === null ? "カード・電子マネー追加" : "カード・電子マネーを編集"}
        subtitle="電子マネー（Suica・PayPay 等）もここから登録すると、この画面で利用履歴を登録できます。銀行口座の登録は「銀行管理」の「銀行追加」から行います。"
        onClose={() => setForm(null)}
        footer={
          <Button
            label={form?.id === null ? "登録" : "保存"}
            disabled={!form?.name || !form?.institution}
            onPress={saveCard}
          />
        }
      >
        {form && (
          <>
            {/* 種別は登録後も変更できる（取り違えて登録したカードをチャージ先に選べるようにするため） */}
            <Field label="種別">
              <Pills
                scroll={false}
                options={LINKED_ACCOUNT_TYPES.map((t) => ({
                  value: t,
                  label: LINKED_ACCOUNT_TYPE_LABELS[t],
                }))}
                value={form.type}
                onChange={(type) => setForm({ ...form, type })}
              />
              <Text style={s.muted}>
                デビット・プリペイド・電子マネーは、他のカードや銀行口座の明細から「チャージ先」として選べるようになります。
                後払いのクレジットカードは残高を持たないため選べません。
              </Text>
              {form.id !== null && !isChargeableType(form.type) && editingChargeSourceCount > 0 && (
                <Text style={s.warn}>
                  このカードをチャージ先に指定している明細が {editingChargeSourceCount} 件あります。
                  クレジットカードに変更すると、以後このカードはチャージ先に選べなくなります（既存の指定はそのまま残ります）。
                </Text>
              )}
            </Field>
            <Field label="名称 *">
              <Input
                value={form.name}
                placeholder={NAME_PLACEHOLDER[form.type]}
                onChangeText={(name) => setForm({ ...form, name })}
              />
            </Field>
            <Field label={form.type === "E_MONEY" ? "発行会社・サービス *" : "カード会社 *"}>
              <Input
                value={form.institution}
                placeholder={form.type === "E_MONEY" ? "例: JR東日本" : "例: 楽天カード株式会社"}
                onChangeText={(institution) => setForm({ ...form, institution })}
              />
            </Field>
            <Field label="下4桁">
              <Input
                value={form.lastFour}
                placeholder="1234"
                maxLength={4}
                keyboardType="number-pad"
                onChangeText={(lastFour) => setForm({ ...form, lastFour })}
              />
            </Field>
            <Field label="紐付き勘定科目">
              <TouchableOpacity style={s.picker} onPress={() => setPickingLedger(true)}>
                <Text style={s.pickerText}>
                  {form.accountCode ? ledgerLabel(form.accountCode) : "なし"}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label="メモ">
              <Input
                value={form.note}
                placeholder="任意"
                onChangeText={(note) => setForm({ ...form, note })}
              />
            </Field>
            {formError && <Notice tone="error">{formError}</Notice>}
          </>
        )}
      </SheetModal>

      <AccountPickerModal
        visible={pickingLedger}
        accounts={categoryAccounts}
        categories={LEDGER_CATEGORIES}
        title="紐付き勘定科目"
        clearLabel="なし"
        currentId={categoryAccounts.find((a) => a.code === form?.accountCode)?.id ?? null}
        onSelect={(a) => {
          if (form) setForm({ ...form, accountCode: a?.code ?? "" });
          setPickingLedger(false);
        }}
        onClose={() => setPickingLedger(false)}
      />
    </View>
  );
}

// ── カレンダー（日ごとの利用・返金の合計と、その日の明細・支払いの追加）───────────
function CardCalendar({
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
