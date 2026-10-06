// 銀行管理（web 版 /bank-accounts と同じ「キャッシュフロー / 一覧 / カレンダー」。CSV インポート・自動取得は web 版のみ）。
//   キャッシュフロー … 残高の推移、資金繰り、毎月の入出金（components/bank/TransferTab）、
//                      銀行口座（追加・編集・削除・差額入力）。口座残高のサマリはホームへ移した
//   明細の一覧と手入力の登録は、実績の画面の「履歴」「カレンダー」（出どころに銀行）へ移した
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
  fetchBankAccounts,
  patchBankAccount,
  postBankAccount,
  type Account,
  type BankAccount,
  type ViewMode,
} from "../api";
import { TransferTab, type ScheduleMode } from "../components/bank/TransferTab";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { CashFlowTrend } from "../components/CashFlowTrend";
import { FundingPlanView } from "../components/FundingPlanView";
import { RecurringSuggestions } from "../components/RecurringSuggestions";
import {
  Button,
  Card,
  Lead,
  Field,
  Input,
  Notice,
  Pills,
  SectionTitle,
  SelectField,
  SheetModal,
} from "../components/ui";
import { displayName } from "../shared/display-name";
import { BANK_HELP } from "../shared/help-texts";
import { digitsOnly, fmtDate, fmtDateTime, MONTHS, yen } from "../format";
import { BANK_ACCOUNT_TYPE_LABEL } from "../shared/labels";
import { useFiscalYear } from "../fiscal-year";

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

type Props = {
  viewMode: ViewMode;
  /** 「明細を見る」から、実績の画面の履歴でこの口座の明細を開く */
  onOpenHistory: (accountId: number) => void;
  /** 実績の履歴の「予定で見る」から開いたときの日（資金移動スケジュールのカレンダーで選ぶ） */
  initialFocusDay?: number | null;
};

export function BankAccountsScreen({ viewMode, onOpenHistory, initialFocusDay = null }: Props) {
  const now = new Date();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountRefs, setAccountRefs] = useState<Account[]>([]);
  // 「表示する銀行」で選んだ口座の id。null はすべての銀行（既定）
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 資金繰り・実績フロー図の起点年月
  // 年は画面上部のサブヘッダーの対象年度（全画面で共通）。ここでは月だけを選ぶ
  const year = useFiscalYear();
  const [month, setMonth] = useState(now.getMonth() + 1);
  // 残高が変わったら資金繰りを取り直すためのキー
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    initialFocusDay !== null ? "calendar" : "list",
  );
  const focusDay = initialFocusDay;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [accs, refs] = await Promise.all([fetchBankAccounts(), fetchAccounts()]);
      setAccounts(accs);
      setAccountRefs(refs);
      // 選んでいた口座が無くなったら、すべての銀行に戻す
      setSelectedId((id) => (id !== null && accs.some((a) => a.id === id) ? id : null));
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

  // 残高が変わる操作の後に、口座サマリ・資金繰り・候補をまとめて取り直す
  const onBalanceChanged = useCallback(() => {
    load();
    setReloadKey((k) => k + 1);
  }, [load]);

  const shownAccounts =
    selectedId === null ? accounts : accounts.filter((a) => a.id === selectedId);
  const totalBalance = shownAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);

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

  // 資金繰り・実績フロー図の起点の月（年は対象年度）
  const periodPicker = (
    <View style={s.periodRow}>
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
      {/* 表示する銀行（全タブ共通。指定なしはすべての銀行をまとめて表示する。web 版と同じ） */}
      <View style={s.selectorCard}>
        <SelectField<number | "all">
          label="表示する銀行"
          value={selectedId ?? "all"}
          options={[
            { value: "all", label: "すべての銀行" },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` })),
          ]}
          onChange={(v) => setSelectedId(v === "all" ? null : v)}
        />
        {accounts.length > 0 && (
          <Text style={s.muted}>
            残高 {yen(totalBalance)} ・ {shownAccounts.length} 口座 ・ {BANK_HELP.selector}
          </Text>
        )}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Lead>{BANK_HELP.page}</Lead>

        <>
          {/* 残高の推移（web 版と同じ。合計の先は予算と実績、口座ごとの先は毎月の入出金から見込む） */}
          <CashFlowTrend year={year} month={month} reloadKey={reloadKey} accountId={selectedId} />

          <SectionTitle note={BANK_HELP.funding}>
            資金繰り（{year}年{month}月から3か月）
          </SectionTitle>
          {periodPicker}
          <FundingPlanView
            year={year}
            month={month}
            months={3}
            reloadKey={reloadKey}
            accountId={selectedId}
          />

          {/* 明細から見つけた毎月の入出金の候補（登録で資金移動ルールになる） */}
          <RecurringSuggestions
            reloadKey={reloadKey}
            onChanged={onBalanceChanged}
            accountId={selectedId}
          />
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

          {/* 銀行口座（資産・借入金の画面と同じく 1 枚のカードにまとめる） */}
          <Card>
            <View style={s.summaryHead}>
              <Text style={s.title}>銀行口座</Text>
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
            {/* 残高の定義と、実残高と差異があるときの対処（差額入力）を案内する */}
            <Text style={s.help}>{BANK_HELP.balance}</Text>
            {accounts.length === 0 ? (
              <Text style={s.muted}>
                口座が登録されていません。「銀行追加」から追加してください。
              </Text>
            ) : (
              <>
                <Text style={s.muted}>
                  残高合計 {yen(totalBalance)} ・ {shownAccounts.length} 口座
                </Text>
                {shownAccounts.map((a) => (
                  <View key={a.id} style={s.accountCard}>
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
                    {/* 差額を入れている口座はその内訳を明示する。差額 0 円を確かめて保存した口座は
                          「明細合計どおり」と出し、まだ確かめていない口座にだけ案内を出す */}
                    {a.balanceAdjustment ? (
                      <Text style={s.muted}>
                        明細合計 {yen(a.transactionSum ?? 0)} ＋ 差額 {yen(a.balanceAdjustment)}
                      </Text>
                    ) : a.balanceCheckedAt ? (
                      <Text style={s.muted}>明細合計どおり（差額なし）</Text>
                    ) : (
                      a._count.transactions > 0 && (
                        <Text style={s.warn}>実際の残高と違う場合は「編集」から差額を入力</Text>
                      )
                    )}
                    {a.account && (
                      <Text style={s.linked}>紐付く科目: {linkedLabel(a.account.code)}</Text>
                    )}
                    <View style={s.cardActions}>
                      {/* 実績の画面の履歴で、この口座の明細を開く */}
                      <TouchableOpacity onPress={() => onOpenHistory(a.id)}>
                        <Text style={s.link}>明細を見る</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEdit(a)}>
                        <Text style={s.link}>編集</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmDelete(a)}>
                        <Text style={s.danger}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}
          </Card>
        </>
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
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 8 },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16 },
  warn: { fontSize: 11, color: "#d97706" },
  accountCard: {
    borderWidth: 1,
    borderColor: "#f1f5f9",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  accountName: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginTop: 2 },
  balance: { fontSize: 18, fontWeight: "700", color: "#4f46e5", marginVertical: 2 },
  linked: { fontSize: 11, color: "#4f46e5", fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  periodRow: { gap: 4, marginBottom: 10 },
  selectorCard: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
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
