// 明細管理（web 版 /shop-accounts と同じ）。Amazon・ヨドバシ・楽天などの通販を「明細分け」として登録する。
// 注文の CSV の取り込みは web 版だけ（PC で落とすファイルのため）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  deleteShopAccount,
  fetchBankAccounts,
  fetchLinkedAccounts,
  fetchShopAccounts,
  patchShopAccount,
  postShopAccount,
  type ShopAccount,
  type ViewMode,
} from "../api";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Lead,
  Notice,
  Pills,
  SectionTitle,
  SheetModal,
} from "../components/ui";
import { BusinessUseSwitch } from "../components/BusinessUseControls";
import { SHOP_HELP } from "../shared/help-texts";
import {
  SHOP_ACCOUNT_TYPES,
  SHOP_ACCOUNT_TYPE_LABELS,
  SHOP_PRESETS,
  parseKeywordList,
  shopKeywords,
  shopOrderHistoryUrl,
} from "../shared/shop-account-type";

type PaymentSource = { id: number; name: string };

type ShopForm = {
  id: number | null; // null = 新規
  name: string;
  type: ShopAccount["type"];
  matchKeywords: string;
  excludeKeywords: string;
  paymentCardIds: number[];
  paymentBankIds: number[];
  statementUrl: string;
  businessUse: boolean;
  note: string;
};

const BLANK_FORM: ShopForm = {
  id: null,
  name: "Amazon",
  type: "AMAZON",
  matchKeywords: "",
  excludeKeywords: "",
  paymentCardIds: [],
  paymentBankIds: [],
  statementUrl: "",
  businessUse: false,
  note: "",
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

export function ShopAccountsScreen({ viewMode }: { viewMode: ViewMode }) {
  const [shops, setShops] = useState<ShopAccount[]>([]);
  const [cards, setCards] = useState<PaymentSource[]>([]);
  const [banks, setBanks] = useState<PaymentSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ShopForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, cardList, bankList] = await Promise.all([
        fetchShopAccounts(),
        fetchLinkedAccounts(),
        fetchBankAccounts(),
      ]);
      setShops(list);
      setCards(cardList);
      setBanks(bankList);
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
    setRefreshing(false);
  }

  async function save() {
    if (!form) return;
    setFormError(null);
    const body = {
      name: form.name,
      type: form.type,
      matchKeywords: parseKeywordList(form.matchKeywords),
      excludeKeywords: parseKeywordList(form.excludeKeywords),
      paymentCardIds: form.paymentCardIds,
      paymentBankIds: form.paymentBankIds,
      businessUse: form.businessUse,
      // 空文字は「既定に戻す・消す」意味なので、編集のときはそのまま送る
      statementUrl: form.statementUrl || form.id !== null ? form.statementUrl : undefined,
      note: form.note || form.id !== null ? form.note : undefined,
    };
    try {
      if (form.id === null) await postShopAccount(body);
      else await patchShopAccount(form.id, body);
      setForm(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  function confirmDelete(a: ShopAccount) {
    Alert.alert("削除", `「${a.name}」を削除してよいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteShopAccount(a.id);
            await load();
          } catch (e) {
            Alert.alert("削除エラー", e instanceof Error ? e.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

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
        <Lead>{SHOP_HELP.page}</Lead>
        <Card>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <SectionTitle note={SHOP_HELP.list}>明細分け</SectionTitle>
            </View>
            <TouchableOpacity
              onPress={() => {
                setFormError(null);
                // 個人事業主モードで足す明細分けは事業利用で始める
                setForm({ ...BLANK_FORM, businessUse: viewMode === "sole" });
              }}
            >
              <Text style={s.link}>＋ 追加</Text>
            </TouchableOpacity>
          </View>
          {shops.length === 0 ? (
            <EmptyText>明細分けが登録されていません。「＋ 追加」から登録してください。</EmptyText>
          ) : (
            shops.map((a) => {
              const kw = shopKeywords(a);
              const payments = [
                ...a.paymentCardIds.map((id) => cardName.get(id)),
                ...a.paymentBankIds.map((id) => bankName.get(id)),
              ].filter(Boolean);
              const url = shopOrderHistoryUrl(a);
              return (
                <View key={a.id} style={s.row}>
                  <View style={s.rowHead}>
                    <Text style={s.badge}>{SHOP_ACCOUNT_TYPE_LABELS[a.type] ?? "その他"}</Text>
                    <Text style={s.name}>{a.name}</Text>
                    {a.businessUse && <Text style={s.business}>事業</Text>}
                  </View>
                  <Text style={s.meta}>
                    摘要: {kw.match.length > 0 ? kw.match.join("、") : "未設定"}
                    {kw.exclude.length > 0 ? ` ・ 除外: ${kw.exclude.join("、")}` : ""}
                  </Text>
                  <Text style={s.meta}>
                    支払い: {payments.length > 0 ? payments.join("、") : "すべてのカード・口座"}
                  </Text>
                  <Text style={s.meta}>
                    {a.chargeCount > 0
                      ? `請求 ${a.chargeCount} 件 ・ 未紐付け ${a.unlinkedCount} 件 ・ 科目なし ${a.uncategorizedCount} 件`
                      : "まだ注文を取り込んでいません（取り込みは web 版で行います）"}
                    {a.lastImportedAt ? ` ・ 最後の取り込み ${fmtDate(a.lastImportedAt)}` : ""}
                  </Text>
                  {a.note ? <Text style={s.muted}>{a.note}</Text> : null}
                  <View style={s.actions}>
                    {url && (
                      <TouchableOpacity onPress={() => Linking.openURL(url)}>
                        <Text style={s.link}>注文履歴を開く</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => {
                        setFormError(null);
                        setForm({
                          id: a.id,
                          name: a.name,
                          type: a.type,
                          matchKeywords: a.matchKeywords.join("、"),
                          excludeKeywords: a.excludeKeywords.join("、"),
                          paymentCardIds: a.paymentCardIds,
                          paymentBankIds: a.paymentBankIds,
                          statementUrl: a.statementUrl ?? "",
                          businessUse: a.businessUse,
                          note: a.note ?? "",
                        });
                      }}
                    >
                      <Text style={s.link}>編集</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDelete(a)}>
                      <Text style={s.danger}>削除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      <SheetModal
        visible={form !== null}
        title={form?.id === null ? "明細分けを追加" : "明細分けを編集"}
        subtitle="通販の注文の CSV を取り込む先です。取り込んだ注文は、カード・銀行の明細に紐付けて、商品ごとに科目を付けます。"
        onClose={() => setForm(null)}
        footer={
          <Button
            label={form?.id === null ? "登録" : "保存"}
            disabled={!form?.name.trim()}
            onPress={save}
          />
        }
      >
        {form && (
          <>
            <Field label="種類">
              <Pills
                scroll={false}
                options={SHOP_ACCOUNT_TYPES.map((t) => ({
                  value: t,
                  label: SHOP_ACCOUNT_TYPE_LABELS[t],
                }))}
                value={form.type}
                onChange={(type) =>
                  setForm({
                    ...form,
                    type,
                    // 名前を既定のまま使っていれば、種類に合わせて替える
                    name:
                      form.name === "" ||
                      SHOP_ACCOUNT_TYPES.some((x) => SHOP_ACCOUNT_TYPE_LABELS[x] === form.name)
                        ? type === "OTHER"
                          ? ""
                          : SHOP_ACCOUNT_TYPE_LABELS[type]
                        : form.name,
                  })
                }
              />
            </Field>
            <Field label="名称 *">
              <Input
                value={form.name}
                placeholder="例: Amazon"
                onChangeText={(name) => setForm({ ...form, name })}
              />
            </Field>
            <Field label="紐付ける明細の摘要">
              <Input
                value={form.matchKeywords}
                placeholder={SHOP_PRESETS[form.type].match.join("、") || "例: SHOPNAME"}
                onChangeText={(matchKeywords) => setForm({ ...form, matchKeywords })}
              />
            </Field>
            <Field label="除外する摘要">
              <Input
                value={form.excludeKeywords}
                placeholder={SHOP_PRESETS[form.type].exclude.join("、") || "なし"}
                onChangeText={(excludeKeywords) => setForm({ ...form, excludeKeywords })}
              />
              <Text style={s.muted}>{SHOP_HELP.keywords}（読点・カンマで区切ります）</Text>
            </Field>
            <Field label="支払いに使うカード・口座">
              {cards.map((c) => (
                <View key={`c${c.id}`} style={s.switchRow}>
                  <Text style={s.switchLabel}>{c.name}</Text>
                  <Switch
                    value={form.paymentCardIds.includes(c.id)}
                    onValueChange={() =>
                      setForm({ ...form, paymentCardIds: toggleId(form.paymentCardIds, c.id) })
                    }
                  />
                </View>
              ))}
              {banks.map((b) => (
                <View key={`b${b.id}`} style={s.switchRow}>
                  <Text style={s.switchLabel}>{b.name}</Text>
                  <Switch
                    value={form.paymentBankIds.includes(b.id)}
                    onValueChange={() =>
                      setForm({ ...form, paymentBankIds: toggleId(form.paymentBankIds, b.id) })
                    }
                  />
                </View>
              ))}
              <Text style={s.muted}>{SHOP_HELP.payment}</Text>
            </Field>
            <Field label="注文履歴のページの URL">
              <Input
                value={form.statementUrl}
                placeholder={SHOP_PRESETS[form.type].url ?? "https://"}
                autoCapitalize="none"
                keyboardType="url"
                onChangeText={(statementUrl) => setForm({ ...form, statementUrl })}
              />
              <Text style={s.muted}>空欄なら種類の既定のページを開きます。</Text>
            </Field>
            <Field label="メモ">
              <Input
                value={form.note}
                placeholder="任意"
                onChangeText={(note) => setForm({ ...form, note })}
              />
            </Field>
            <BusinessUseSwitch
              kind="shop"
              value={form.businessUse}
              onChange={(businessUse) => setForm({ ...form, businessUse })}
            />
            {formError && <Notice tone="error">{formError}</Notice>}
          </>
        )}
      </SheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, paddingBottom: 32 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  row: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 10 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badge: {
    fontSize: 11,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  name: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  business: {
    fontSize: 10,
    color: "#1d4ed8",
    backgroundColor: "#dbeafe",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  meta: { fontSize: 12, color: "#64748b", marginTop: 3 },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 4 },
  actions: { flexDirection: "row", gap: 16, marginTop: 6 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  switchLabel: { fontSize: 14, color: "#1e293b", flex: 1 },
});
