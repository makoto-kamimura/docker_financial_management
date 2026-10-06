// カード・電子マネー管理（web 版 /card-transactions のサマリと同じ。CSV 取込は web 版のみ）。
// 明細の一覧・カレンダーは、実績の画面の「履歴」「カレンダー」（出どころにカード・電子マネー）へ移した。
// クレジット・デビット・プリペイド・電子マネーは明細の構造が同じなので同じ画面で扱う。
// 銀行口座を起点にする引き落としの登録は銀行管理側の役割で、ここではチャージ先の指定と固定決済の登録を行う。
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
  deleteLinkedAccount,
  fetchAccounts,
  fetchLinkedAccounts,
  patchLinkedAccount,
  postLinkedAccount,
  type Account,
  type LinkedAccount,
  type ViewMode,
} from "../api";
import { CardSummary } from "../components/card/CardSummary";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { Button, Field, Input, Lead, Notice, Pills, SheetModal } from "../components/ui";
import { displayName } from "../shared/display-name";
import { CARD_HELP } from "../shared/help-texts";
import {
  isChargeableType,
  LINKED_ACCOUNT_TYPE_LABELS,
  LINKED_ACCOUNT_TYPES,
} from "../shared/linked-account-type";

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

type Props = {
  viewMode: ViewMode;
  /** 「明細を見る」から、実績の画面の履歴でこのカードの明細を開く */
  onOpenHistory: (accountId: number) => void;
};

export function CardTransactionsScreen({ viewMode, onOpenHistory }: Props) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [categoryAccounts, setCategoryAccounts] = useState<Account[]>([]);
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
          await postLinkedAccount(body);
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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Lead>{CARD_HELP.page}</Lead>
        <CardSummary
          accounts={accounts}
          reloadKey={reloadKey}
          onAdd={() => {
            setFormError(null);
            setForm(BLANK_CARD);
          }}
          onEdit={(a) => {
            setFormError(null);
            setForm({
              id: a.id,
              name: a.name,
              type: a.type,
              institution: a.institution,
              lastFour: a.lastFour ?? "",
              accountCode: a.account?.code ?? "",
              note: a.note ?? "",
            });
          }}
          onDelete={confirmDeleteCard}
          onOpenHistory={onOpenHistory}
        />
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
