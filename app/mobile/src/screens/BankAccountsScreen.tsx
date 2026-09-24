// 銀行管理（web 版 /bank-accounts と同じ「サマリ / 明細一覧 / 振替」。CSV インポート・自動取得は web 版のみ）。
//   サマリ … 口座サマリ（追加・編集・削除・差額入力）、残高推移、資金繰り
//   明細一覧 … components/bank/BankTransactionsList
//   振替 … components/bank/TransferTab
import { useCallback, useEffect, useState } from "react";
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
  deleteBankAccount,
  fetchAccounts,
  fetchBalanceTrend,
  fetchBankAccounts,
  patchBankAccount,
  postBankAccount,
  type Account,
  type BalanceTrendPoint,
  type BankAccount,
  type TrendGranularity,
  type ViewMode,
} from "../api";
import { BalanceTrendChart } from "../components/BalanceTrendChart";
import { BankTransactionsList } from "../components/bank/BankTransactionsList";
import { TransferTab, type ScheduleMode } from "../components/bank/TransferTab";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { FundingPlanView } from "../components/FundingPlanView";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Notice,
  Pills,
  SectionTitle,
  SheetModal,
  TabBar,
} from "../components/ui";
import { displayName } from "../shared/display-name";
import { digitsOnly, fmtDate, fmtDateTime, MONTHS, yen } from "../format";
import { BANK_ACCOUNT_TYPE_LABEL } from "../shared/labels";

type Tab = "summary" | "list" | "flow";
const TABS = [
  ["summary", "サマリ"],
  ["list", "明細一覧"],
  ["flow", "振替"],
] as const;

// 口座サマリの残高の説明（web 版の BALANCE_HELP_TEXT と同じ）
const BALANCE_HELP_TEXT =
  "残高は「取り込んだ明細の増減合計 + 差額」で表示しています。取得できる明細をすべて登録したのに実際の残高と" +
  "差異がある場合は、取込開始前から口座にあった残高（期首残高）などが含まれていないためです。" +
  "口座の「編集」から差額を入力してください。差額は総資産サマリ・資金繰り・残高推移グラフにも反映されます。";

// 紐付き勘定科目に選べるのは資産・負債のみ（web 版と同じ）
const LINKABLE = ["ASSET", "LIABILITY"] as const;

type AccountForm = {
  id: number | null; // null = 新規
  name: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  lastFour: string;
  accountCode: string;
  note: string;
  balanceAdjustment: string;
  transactionSum: number;
};

const BLANK_FORM: AccountForm = {
  id: null,
  name: "",
  bankName: "",
  branchName: "",
  accountType: "ORDINARY",
  accountNumber: "",
  lastFour: "",
  accountCode: "",
  note: "",
  balanceAdjustment: "",
  transactionSum: 0,
};

type Props = { viewMode: ViewMode };

export function BankAccountsScreen({ viewMode }: Props) {
  const now = new Date();
  const [tab, setTab] = useState<Tab>("summary");
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountRefs, setAccountRefs] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 残高推移・資金繰り・実績フロー図の起点年月
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [granularity, setGranularity] = useState<TrendGranularity>("month");
  const [trend, setTrend] = useState<{
    accounts: { id: number; name: string }[];
    points: BalanceTrendPoint[];
  } | null>(null);
  // 残高が変わったら資金繰り・残高推移を取り直すためのキー
  const [reloadKey, setReloadKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("list");
  const [focusDay, setFocusDay] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [accs, refs] = await Promise.all([fetchBankAccounts(), fetchAccounts()]);
      setAccounts(accs);
      setAccountRefs(refs);
      setSelectedId((id) => id ?? accs[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "summary") return;
    setTrend(null);
    fetchBalanceTrend({ year, month, granularity })
      .then(setTrend)
      .catch(() => setTrend({ accounts: [], points: [] }));
  }, [tab, year, month, granularity, reloadKey]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setReloadKey((k) => k + 1);
    setRefreshing(false);
  }

  // 残高が変わる操作の後に、口座サマリ・残高推移・資金繰りをまとめて取り直す
  const onBalanceChanged = useCallback(() => {
    load();
    setReloadKey((k) => k + 1);
  }, [load]);

  const totalBalance = accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const totalTxCount = accounts.reduce((sum, a) => sum + (a._count?.transactions ?? 0), 0);
  const lastUpdatedAt = accounts.reduce<string | null>(
    (latest, a) =>
      a.lastUpdatedAt && (!latest || a.lastUpdatedAt > latest) ? a.lastUpdatedAt : latest,
    null,
  );

  function openEdit(a: BankAccount) {
    setFormError(null);
    setForm({
      ...BLANK_FORM,
      id: a.id,
      name: a.name,
      bankName: a.bankName,
      lastFour: a.lastFour ?? "",
      accountCode: a.account?.code ?? "",
      note: a.note ?? "",
      balanceAdjustment: a.balanceAdjustment ? String(a.balanceAdjustment) : "",
      transactionSum: a.transactionSum ?? 0,
    });
  }

  async function saveForm() {
    if (!form) return;
    setFormError(null);
    try {
      if (form.id === null) {
        // 空欄の任意項目は送らない（undefined は JSON から落ちる）
        await postBankAccount({
          name: form.name,
          bankName: form.bankName,
          accountType: form.accountType,
          branchName: form.branchName || undefined,
          accountNumber: form.accountNumber || undefined,
          lastFour: form.lastFour || undefined,
          accountCode: form.accountCode || undefined,
          note: form.note || undefined,
        });
      } else {
        await patchBankAccount(form.id, {
          name: form.name,
          bankName: form.bankName,
          lastFour: form.lastFour,
          accountCode: form.accountCode,
          note: form.note,
          // 空欄は差額なし（0）として送る
          balanceAdjustment: Number(form.balanceAdjustment || 0),
        });
      }
      setForm(null);
      onBalanceChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  function confirmDelete(a: BankAccount) {
    Alert.alert("口座を削除", `「${a.name}」を削除してよいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteBankAccount(a.id);
            if (selectedId === a.id) setSelectedId(null);
            onBalanceChanged();
          } catch (e) {
            Alert.alert("削除エラー", e instanceof Error ? e.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  const linkedLabel = (code: string) => {
    const a = accountRefs.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "なし";
  };

  // 残高推移・資金繰り・実績フロー図の起点年月（web 版と同じく直近 5 年から選ぶ）
  const periodPicker = (
    <View style={s.periodRow}>
      <Pills
        options={Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => ({
          value: y,
          label: `${y}年`,
        }))}
        value={year}
        onChange={setYear}
      />
      <Pills
        options={MONTHS.map((m) => ({ value: m, label: `${m}月` }))}
        value={month}
        onChange={setMonth}
      />
    </View>
  );

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

        {tab === "summary" && (
          <>
            <Card>
              <View style={s.summaryHead}>
                <Text style={s.title}>口座サマリ</Text>
                <TouchableOpacity onPress={() => setShowHelp((v) => !v)} hitSlop={8}>
                  <Text style={s.helpIcon}>?</Text>
                </TouchableOpacity>
                <Button
                  small
                  label="銀行追加"
                  onPress={() => {
                    setFormError(null);
                    setForm(BLANK_FORM);
                  }}
                  style={{ marginLeft: "auto" }}
                />
              </View>
              {showHelp && <Text style={s.help}>{BALANCE_HELP_TEXT}</Text>}
              {accounts.length === 0 ? (
                <Text style={s.muted}>
                  口座が登録されていません。「銀行追加」から追加してください。
                </Text>
              ) : (
                <>
                  <View style={s.stats}>
                    <View style={s.stat}>
                      <Text style={s.statLabel}>総残高</Text>
                      <Text style={s.statTotal}>{yen(totalBalance)}</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={s.statLabel}>口座数</Text>
                      <Text style={s.statValue}>{accounts.length}</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={s.statLabel}>取引件数</Text>
                      <Text style={s.statValue}>{totalTxCount}</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={s.statLabel}>最終更新</Text>
                      <Text style={s.statSmall}>
                        {lastUpdatedAt ? fmtDateTime(lastUpdatedAt) : "—"}
                      </Text>
                      <Text style={s.muted}>明細を最後に登録した日時</Text>
                    </View>
                  </View>
                  {accounts.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={[s.accountCard, selectedId === a.id && s.accountCardSelected]}
                      onPress={() => setSelectedId(a.id)}
                    >
                      <Text style={s.muted}>
                        {a.bankName}
                        {a.branchName ? ` ${a.branchName}` : ""} /{" "}
                        {BANK_ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType}
                      </Text>
                      <Text style={s.accountName}>{a.name}</Text>
                      <Text style={s.balance}>{yen(a.balance ?? 0)}</Text>
                      <Text style={s.muted}>
                        {a._count.transactions}件の取引
                        {a._count.transactions > 0 && a.lastTransactionDate
                          ? ` / 最新 ${fmtDate(a.lastTransactionDate)}`
                          : ""}
                      </Text>
                      <Text style={s.muted}>
                        最終更新 {a.lastUpdatedAt ? fmtDateTime(a.lastUpdatedAt) : "—"}
                      </Text>
                      {/* 差額を入れている口座はその内訳を明示する。未入力の口座には案内を出す */}
                      {a.balanceAdjustment ? (
                        <Text style={s.muted}>
                          明細合計 {yen(a.transactionSum ?? 0)} ＋ 差額 {yen(a.balanceAdjustment)}
                        </Text>
                      ) : (
                        a._count.transactions > 0 && (
                          <Text style={s.warn}>実際の残高と違う場合は編集から差額を入力</Text>
                        )
                      )}
                      {a.account && <Text style={s.linked}>→ {linkedLabel(a.account.code)}</Text>}
                      <View style={s.cardActions}>
                        <TouchableOpacity onPress={() => openEdit(a)}>
                          <Text style={s.link}>編集</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmDelete(a)}>
                          <Text style={s.danger}>削除</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </Card>

            <SectionTitle>表示対象</SectionTitle>
            {periodPicker}

            <Card>
              <SectionTitle
                note={`${year}年${month}月の前後6か月。実線＝実績、破線＝資金移動の設定からの推測。${granularity === "day" ? "日次は各日の残高。" : ""}`}
              >
                残高推移
              </SectionTitle>
              <Pills
                scroll={false}
                options={[
                  { value: "month" as const, label: "月次" },
                  { value: "day" as const, label: "日次" },
                ]}
                value={granularity}
                onChange={setGranularity}
              />
              {!trend ? (
                <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
              ) : trend.accounts.length === 0 ? (
                <EmptyText>
                  口座が登録されていません。上の「銀行追加」から追加してください。
                </EmptyText>
              ) : (
                <BalanceTrendChart
                  points={trend.points}
                  accounts={trend.accounts}
                  targetMonth={`${year}-${String(month).padStart(2, "0")}`}
                  granularity={granularity}
                />
              )}
            </Card>

            <SectionTitle note="引き落としに間に合わせるための預け入れ期限と必要額を表示します。">
              資金繰り（{year}年{month}月から3か月）
            </SectionTitle>
            <FundingPlanView year={year} month={month} months={3} reloadKey={reloadKey} />
          </>
        )}

        {tab === "list" && (
          <BankTransactionsList
            accounts={accounts}
            accountId={selectedId}
            onAccountIdChange={setSelectedId}
            categoryAccounts={accountRefs}
            viewMode={viewMode}
            onBalanceChanged={onBalanceChanged}
            onOpenCalendar={(date) => {
              setFocusDay(new Date(date).getDate());
              setScheduleMode("calendar");
              setTab("flow");
            }}
          />
        )}

        {tab === "flow" && (
          <>
            {periodPicker}
            <TransferTab
              accounts={accounts}
              accountId={selectedId}
              year={year}
              month={month}
              scheduleMode={scheduleMode}
              onScheduleModeChange={setScheduleMode}
              focusDay={focusDay}
              onBalanceChanged={onBalanceChanged}
            />
          </>
        )}
      </ScrollView>

      {/* 口座の登録・編集 */}
      <SheetModal
        visible={form !== null}
        title={form?.id === null ? "銀行追加" : "銀行口座を編集"}
        subtitle={
          form?.id === null
            ? "クレジットカード・電子マネーの登録は「カード・電子マネー管理」で行います。"
            : undefined
        }
        onClose={() => setForm(null)}
        footer={
          <Button
            label={form?.id === null ? "登録" : "保存"}
            disabled={!form?.name || !form?.bankName}
            onPress={saveForm}
          />
        }
      >
        {form && (
          <>
            <Field label="名称 *">
              <Input
                value={form.name}
                placeholder="例: 住信SBI普通"
                onChangeText={(name) => setForm({ ...form, name })}
              />
            </Field>
            <Field label="金融機関 *">
              <Input
                value={form.bankName}
                placeholder="例: 住信SBIネット銀行"
                onChangeText={(bankName) => setForm({ ...form, bankName })}
              />
            </Field>
            {form.id === null && (
              <>
                <Field label="支店名">
                  <Input
                    value={form.branchName}
                    onChangeText={(branchName) => setForm({ ...form, branchName })}
                  />
                </Field>
                <Field label="口座種別">
                  <Pills
                    scroll={false}
                    options={Object.entries(BANK_ACCOUNT_TYPE_LABEL).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    value={form.accountType}
                    onChange={(accountType) => setForm({ ...form, accountType })}
                  />
                </Field>
                <Field label="口座番号">
                  <Input
                    value={form.accountNumber}
                    keyboardType="number-pad"
                    onChangeText={(accountNumber) => setForm({ ...form, accountNumber })}
                  />
                </Field>
              </>
            )}
            <Field label="下4桁">
              <Input
                value={form.lastFour}
                placeholder="1234"
                maxLength={4}
                keyboardType="number-pad"
                onChangeText={(lastFour) => setForm({ ...form, lastFour })}
              />
            </Field>
            {form.id !== null && (
              <View style={s.adjustBox}>
                <Field label="残高の差額（円）">
                  <Text style={s.muted}>
                    取得できる明細を登録したのに現在の残高と差異がある場合は、差額を入力してください。
                    取込開始前から口座にあった残高（期首残高）などが該当します。
                  </Text>
                  <Input
                    keyboardType="numbers-and-punctuation"
                    value={form.balanceAdjustment}
                    placeholder="例: 554929"
                    onChangeText={(t) =>
                      setForm({ ...form, balanceAdjustment: digitsOnly(t, true) })
                    }
                  />
                </Field>
                <Text style={s.muted}>
                  明細合計 {yen(form.transactionSum)} ＋ 差額{" "}
                  {yen(Number(form.balanceAdjustment || 0))} ＝{" "}
                  <Text style={s.linked}>
                    {yen(form.transactionSum + Number(form.balanceAdjustment || 0))}
                  </Text>
                </Text>
              </View>
            )}
            <Field label="紐付き勘定科目">
              <TouchableOpacity style={s.picker} onPress={() => setPickingAccount(true)}>
                <Text style={s.pickerText}>
                  {form.accountCode ? linkedLabel(form.accountCode) : "なし"}
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
        visible={pickingAccount}
        accounts={accountRefs}
        categories={LINKABLE}
        title="紐付き勘定科目"
        clearLabel="なし"
        currentId={accountRefs.find((a) => a.code === form?.accountCode)?.id ?? null}
        onSelect={(a) => {
          if (form) setForm({ ...form, accountCode: a?.code ?? "" });
          setPickingAccount(false);
        }}
        onClose={() => setPickingAccount(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, paddingBottom: 32 },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  helpIcon: {
    fontSize: 10,
    color: "#64748b",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    width: 16,
    height: 16,
    textAlign: "center",
    lineHeight: 14,
  },
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 8 },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16 },
  warn: { fontSize: 11, color: "#d97706" },
  stats: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  stat: { width: "50%", paddingVertical: 6 },
  statLabel: { fontSize: 11, color: "#64748b" },
  statTotal: { fontSize: 20, fontWeight: "700", color: "#4f46e5" },
  statValue: { fontSize: 20, fontWeight: "700", color: "#334155" },
  statSmall: { fontSize: 13, fontWeight: "700", color: "#334155", marginTop: 4 },
  accountCard: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  accountCardSelected: { borderColor: "#818cf8", backgroundColor: "#eef2ff" },
  accountName: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginTop: 2 },
  balance: { fontSize: 18, fontWeight: "700", color: "#4f46e5", marginVertical: 2 },
  linked: { fontSize: 11, color: "#4f46e5", fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  periodRow: { gap: 4, marginBottom: 10 },
  adjustBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    padding: 10,
    marginBottom: 10,
  },
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
