// 資産管理（web 版 /assets と同じ「総資産サマリ」＋「実物資産」）。
// ASSET / LIABILITY 科目の残高から作っていた KPI・純資産推移は、家計モードでは科目側に残高を積まないため
// 常に 0 円になる。web 版と同じく撤去し、総資産サマリ（銀行口座・実物資産・ローンの実データ）に一本化した。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  deletePersonalAsset,
  fetchAccounts,
  fetchNetWorthSummary,
  fetchPersonalAssets,
  patchPersonalAsset,
  postPersonalAsset,
  type Account,
  type NetWorthSummary,
  type PersonalAsset,
  type PersonalAssetInput,
  type ViewMode,
} from "../api";
import { AccountPickerModal } from "../components/CategoryPickerModal";
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
} from "../components/ui";
import { displayName } from "../shared/display-name";
import { digitsOnly, yenShort } from "../format";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "../shared/labels";

const CATEGORY_OPTIONS = (
  Object.keys(PERSONAL_ASSET_CATEGORY_LABEL) as PersonalAssetCategory[]
).map((value) => ({
  value,
  label: PERSONAL_ASSET_CATEGORY_LABEL[value],
}));

// 登録・編集フォーム（数値は文字列で持ち、年利は画面では「％」で入力して API へは小数で送る）
type AssetForm = {
  id: number | null; // null = 新規
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string;
  acquisitionCost: string;
  currentValue: string;
  countAsAsset: boolean;
  note: string;
  linkedAccountId: number | null;
  debtStartOn: string;
  debtPayoffDue: string;
  debtInitialAmount: string;
  debtInterestPercent: string;
  debtResidualValue: string;
};

const BLANK_FORM: AssetForm = {
  id: null,
  name: "",
  category: "LAND",
  acquiredOn: "",
  acquisitionCost: "",
  currentValue: "",
  countAsAsset: true,
  note: "",
  linkedAccountId: null,
  debtStartOn: "",
  debtPayoffDue: "",
  debtInitialAmount: "",
  debtInterestPercent: "",
  debtResidualValue: "",
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const str = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));

function toForm(a: PersonalAsset): AssetForm {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    acquiredOn: a.acquiredOn?.slice(0, 10) ?? "",
    acquisitionCost: str(a.acquisitionCost),
    currentValue: str(a.currentValue),
    countAsAsset: a.countAsAsset,
    note: a.note ?? "",
    linkedAccountId: a.linkedAccountId,
    debtStartOn: a.debtStartOn?.slice(0, 7) ?? "",
    debtPayoffDue: a.debtPayoffDue?.slice(0, 7) ?? "",
    debtInitialAmount: str(a.debtInitialAmount),
    // 小数（0.0081）→ ％表示（0.81）。浮動小数の端数が出ないよう有効桁で丸める
    debtInterestPercent:
      a.debtInterestRate === null
        ? ""
        : String(Number((Number(a.debtInterestRate) * 100).toPrecision(6))),
    debtResidualValue: str(a.debtResidualValue),
  };
}

function toInput(f: AssetForm): PersonalAssetInput {
  const linked = f.linkedAccountId !== null;
  return {
    name: f.name.trim(),
    category: f.category,
    acquiredOn: f.acquiredOn || null,
    acquisitionCost: numOrNull(f.acquisitionCost),
    currentValue: Number(f.currentValue),
    countAsAsset: f.countAsAsset,
    note: f.note || null,
    linkedAccountId: f.linkedAccountId,
    // 負債の項目は紐付け負債科目があるときだけ意味を持つ
    debtStartOn: linked ? f.debtStartOn || null : null,
    debtPayoffDue: linked ? f.debtPayoffDue || null : null,
    debtInitialAmount: linked ? numOrNull(f.debtInitialAmount) : null,
    debtInterestRate:
      linked && f.debtInterestPercent !== "" ? Number(f.debtInterestPercent) / 100 : null,
    debtResidualValue: linked ? numOrNull(f.debtResidualValue) : null,
  };
}

type Props = { viewMode: ViewMode };

export function AssetsScreen({ viewMode }: Props) {
  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [assets, setAssets] = useState<PersonalAsset[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingDebt, setPickingDebt] = useState(false);
  const [editValue, setEditValue] = useState<{ id: number; value: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sum, pa, accs] = await Promise.all([
        fetchNetWorthSummary(),
        fetchPersonalAssets(),
        fetchAccounts(),
      ]);
      setSummary(sum);
      setAssets(pa);
      setAccounts(accs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "資産データの取得に失敗しました");
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

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert("エラー", e instanceof Error ? e.message : "処理に失敗しました");
    }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim() || form.currentValue === "")
      return setFormError("資産名と現在評価額は必須です。");
    if (form.debtStartOn && form.debtPayoffDue && form.debtStartOn > form.debtPayoffDue)
      return setFormError("支払い開始年月は解消予定年月以前にしてください。");
    setSaving(true);
    setFormError(null);
    try {
      const input = toInput(form);
      if (form.id === null) await postPersonalAsset(input);
      else await patchPersonalAsset(form.id, input);
      setForm(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(a: PersonalAsset) {
    Alert.alert("削除", `「${a.name}」を削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: () => run(() => deletePersonalAsset(a.id)) },
    ]);
  }

  const liabilityAccounts = accounts.filter((a) => a.category === "LIABILITY");
  const debtLabel = (id: number | null) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "なし";
  };
  const total = assets
    .filter((a) => a.countAsAsset)
    .reduce((sum, a) => sum + Number(a.currentValue), 0);
  const totalDebt = assets.reduce((sum, a) => sum + (a.debtRemaining ?? 0), 0);
  const hasExcluded = assets.some((a) => !a.countAsAsset);

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
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}

        {/* ── 総資産サマリ（F-8）── */}
        {summary && (
          <Card>
            <SectionTitle note="実物資産・銀行口座残高・ローンを含む純資産">
              総資産サマリ（{summary.year}年{summary.month}月時点）
            </SectionTitle>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statLabel}>総資産</Text>
                <Text style={[s.statValue, { color: "#059669" }]}>
                  {yenShort(summary.totalAssets)}
                </Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statLabel}>総負債</Text>
                <Text style={[s.statValue, { color: "#e11d48" }]}>
                  {yenShort(summary.totalLiabilities)}
                </Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statLabel}>純資産</Text>
                <Text
                  style={[s.statValue, { color: summary.netWorth >= 0 ? "#4f46e5" : "#dc2626" }]}
                >
                  {yenShort(summary.netWorth)}
                </Text>
              </View>
            </View>
            <View style={s.breakdown}>
              {summary.breakdown
                .filter((b) => b.amount !== 0)
                .map((b) => (
                  <Text key={b.key} style={s.breakdownItem}>
                    {b.label}: <Text style={s.breakdownValue}>{yenShort(b.amount)}</Text>
                  </Text>
                ))}
            </View>
          </Card>
        )}

        {/* ── 実物資産 ── */}
        <Card>
          <SectionTitle
            note={
              `合計評価額: ${yenShort(total)}` +
              (totalDebt > 0 ? ` ・ 負債残高合計: ${yenShort(totalDebt)}` : "") +
              (hasExcluded ? " ・ 「資産計上外」の項目は負債のみ反映" : "")
            }
          >
            実物資産（土地・建物・車・金など）
          </SectionTitle>
          <Button
            small
            label="+ 資産を登録"
            onPress={() => {
              setFormError(null);
              setForm(BLANK_FORM);
            }}
            style={{ alignSelf: "flex-start", marginBottom: 8 }}
          />
          {assets.length === 0 ? (
            <EmptyText>登録済みの実物資産がありません。</EmptyText>
          ) : (
            assets.map((a) => (
              <View key={a.id} style={s.asset}>
                <View style={s.assetHead}>
                  <Text style={s.categoryBadge}>
                    {PERSONAL_ASSET_CATEGORY_LABEL[a.category] ?? a.category}
                  </Text>
                  <Text style={s.assetName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  {/* 純資産に計上するかの切り替え（ローンの諸費用などを資産計上外にする） */}
                  <TouchableOpacity
                    style={[s.countBadge, !a.countAsAsset && s.countBadgeOff]}
                    onPress={() =>
                      run(() => patchPersonalAsset(a.id, { countAsAsset: !a.countAsAsset }))
                    }
                  >
                    <Text style={[s.countText, !a.countAsAsset && s.countTextOff]}>
                      {a.countAsAsset ? "資産計上" : "資産計上外"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.muted}>
                  {a.acquiredOn ? `取得日: ${a.acquiredOn.slice(0, 10)} ・ ` : ""}
                  {a.acquisitionCost !== null
                    ? `取得価格: ${yenShort(Number(a.acquisitionCost))} ・ `
                    : ""}
                  登録日: {a.createdAt.slice(0, 10)}
                </Text>
                {a.debtRemaining !== null && (
                  <Text style={s.debt}>
                    負債残高: {yenShort(a.debtRemaining)}（残り{a.debtRemainingMonths}回・月
                    {yenShort(a.debtMonthly ?? 0)}・年利
                    {(Number(a.debtInterestRate ?? 0) * 100).toFixed(3)}%・
                    {a.debtPayoffDue?.slice(0, 7)}解消予定）
                    {Number(a.debtResidualValue ?? 0) > 0 &&
                      `\n残価設定ローン: 最終回に ${yenShort(Number(a.debtResidualValue))} を一括支払い`}
                  </Text>
                )}
                <View style={s.assetFoot}>
                  {editValue?.id === a.id ? (
                    <View style={s.valueEdit}>
                      <Input
                        autoFocus
                        keyboardType="number-pad"
                        value={editValue.value}
                        onChangeText={(t) => setEditValue({ id: a.id, value: digitsOnly(t) })}
                        style={s.valueInput}
                      />
                      <Button
                        small
                        label="✓"
                        onPress={() => {
                          const value = Number(editValue.value);
                          setEditValue(null);
                          run(() => patchPersonalAsset(a.id, { currentValue: value }));
                        }}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setEditValue({ id: a.id, value: str(a.currentValue) })}
                    >
                      <Text style={s.value}>{yenShort(Number(a.currentValue))}</Text>
                      <Text style={s.muted}>タップして評価額を更新</Text>
                    </TouchableOpacity>
                  )}
                  <View style={s.actions}>
                    <TouchableOpacity
                      onPress={() => {
                        setFormError(null);
                        setForm(toForm(a));
                      }}
                    >
                      <Text style={s.link}>編集</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDelete(a)}>
                      <Text style={s.danger}>削除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      {/* ── 実物資産の登録・編集 ── */}
      <SheetModal
        visible={form !== null}
        title={form?.id === null ? "実物資産 登録" : "実物資産 編集"}
        onClose={() => setForm(null)}
        footer={
          <Button label={form?.id === null ? "登録" : "保存"} onPress={save} loading={saving} />
        }
      >
        {form && (
          <>
            <Field label="資産名 *">
              <Input
                value={form.name}
                placeholder="自宅土地"
                onChangeText={(name) => setForm({ ...form, name })}
              />
            </Field>
            <Field label="種別">
              <Pills
                scroll={false}
                options={CATEGORY_OPTIONS}
                value={form.category}
                onChange={(category) => setForm({ ...form, category })}
              />
            </Field>
            <Field label="取得日（YYYY-MM-DD）">
              <Input
                value={form.acquiredOn}
                placeholder="2020-04-01"
                onChangeText={(acquiredOn) => setForm({ ...form, acquiredOn })}
              />
            </Field>
            <Field label="取得価格（円）">
              <Input
                keyboardType="number-pad"
                value={form.acquisitionCost}
                onChangeText={(t) => setForm({ ...form, acquisitionCost: digitsOnly(t) })}
              />
            </Field>
            <Field label="現在評価額（円） *">
              <Input
                keyboardType="number-pad"
                value={form.currentValue}
                onChangeText={(t) => setForm({ ...form, currentValue: digitsOnly(t) })}
              />
            </Field>
            <Field label="紐付け負債科目（ローン等）">
              <TouchableOpacity style={s.picker} onPress={() => setPickingDebt(true)}>
                <Text style={s.pickerText}>{debtLabel(form.linkedAccountId)}</Text>
              </TouchableOpacity>
            </Field>
            {form.linkedAccountId !== null && (
              <>
                <Field label="当初負債額（円）">
                  <Input
                    keyboardType="number-pad"
                    value={form.debtInitialAmount}
                    onChangeText={(t) => setForm({ ...form, debtInitialAmount: digitsOnly(t) })}
                  />
                </Field>
                <Field label="年利（％）">
                  <Input
                    keyboardType="decimal-pad"
                    value={form.debtInterestPercent}
                    placeholder="例: 0.810"
                    onChangeText={(debtInterestPercent) =>
                      setForm({ ...form, debtInterestPercent })
                    }
                  />
                </Field>
                <Field label="支払い開始年月（YYYY-MM）">
                  <Input
                    value={form.debtStartOn}
                    placeholder="2024-04"
                    onChangeText={(debtStartOn) => setForm({ ...form, debtStartOn })}
                  />
                </Field>
                <Field label="負債解消（完済）予定年月（YYYY-MM）">
                  <Input
                    value={form.debtPayoffDue}
                    placeholder="2059-03"
                    onChangeText={(debtPayoffDue) => setForm({ ...form, debtPayoffDue })}
                  />
                </Field>
                <Field label="残価（円）">
                  <Input
                    keyboardType="number-pad"
                    value={form.debtResidualValue}
                    placeholder="残価設定ローンのみ"
                    onChangeText={(t) => setForm({ ...form, debtResidualValue: digitsOnly(t) })}
                  />
                </Field>
              </>
            )}
            <Text style={s.muted}>
              当初負債額・開始年月・解消予定年月を設定すると、開始月〜解消予定月の毎月の返済額を予算に自動計上し、
              負債残高を算出して表示します。年利を入力すると元利均等返済で計算します（未入力は無利子＝元本の月割り）。
              残価設定ローン（カーローン等）は残価を入力すると、最終回に残価を一括で支払う前提で月額と残高を計算します。
            </Text>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchLabel}>純資産に評価額を計上する</Text>
                <Text style={s.muted}>
                  ローンに含まれる登記費用・手数料など、借入はあるが資産価値を持たない項目はオフにしてください。
                  オフにすると負債だけが純資産に反映されます。
                </Text>
              </View>
              <Switch
                value={form.countAsAsset}
                onValueChange={(countAsAsset) => setForm({ ...form, countAsAsset })}
              />
            </View>
            <Field label="備考">
              <Input value={form.note} onChangeText={(note) => setForm({ ...form, note })} />
            </Field>
            {formError && <Notice tone="error">{formError}</Notice>}
          </>
        )}
      </SheetModal>

      <AccountPickerModal
        visible={pickingDebt}
        accounts={liabilityAccounts}
        title="紐付け負債科目"
        clearLabel="なし"
        currentId={form?.linkedAccountId ?? null}
        onSelect={(a) => {
          if (form) setForm({ ...form, linkedAccountId: a?.id ?? null });
          setPickingDebt(false);
        }}
        onClose={() => setPickingDebt(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, paddingBottom: 32 },
  stats: { flexDirection: "row", marginBottom: 10 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, color: "#64748b", marginBottom: 2 },
  statValue: { fontSize: 17, fontWeight: "700" },
  breakdown: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 8,
  },
  breakdownItem: { fontSize: 11, color: "#64748b" },
  breakdownValue: { color: "#334155", fontWeight: "600" },
  asset: { borderWidth: 1, borderColor: "#f1f5f9", borderRadius: 10, padding: 10, marginBottom: 8 },
  assetHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  categoryBadge: {
    fontSize: 10,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  assetName: { flex: 1, fontSize: 14, fontWeight: "600", color: "#1e293b" },
  countBadge: {
    borderWidth: 1,
    borderColor: "#a7f3d0",
    backgroundColor: "#ecfdf5",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadgeOff: { borderColor: "#fde68a", backgroundColor: "#fffbeb" },
  countText: { fontSize: 10, color: "#059669" },
  countTextOff: { color: "#d97706" },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 3 },
  debt: { fontSize: 11, color: "#d97706", lineHeight: 16, marginTop: 3 },
  assetFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  value: { fontSize: 16, fontWeight: "700", color: "#1e293b" },
  valueEdit: { flexDirection: "row", alignItems: "center", gap: 6 },
  valueInput: { width: 130, textAlign: "right", paddingVertical: 6 },
  actions: { flexDirection: "row", gap: 16 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  picker: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 10,
    marginVertical: 10,
  },
  switchLabel: { fontSize: 13, color: "#334155", fontWeight: "600" },
});
