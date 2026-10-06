// 資産管理（web 版 /assets と同じ「実物資産の評価額の推移」＋「実物資産」）。
// 総資産サマリ（口座・借入金を含む純資産）はホームへ移し、KPI の対象月の時点で出す（NetWorthSummaryCard）。
// 実物資産は、住宅ローン 1 本で買った土地と建物のように、1 つの資産に内訳を持てる（ローンは 1 本のまま）。
// 評価額は、入れた日の値を通り、今月より先は価値の変わり方で見積もる（shared/asset-valuation.ts）。
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
  fetchAssetTrend,
  fetchPersonalAssets,
  patchPersonalAsset,
  postPersonalAsset,
  type Account,
  type AssetTrend,
  type AssetTrendSeries,
  type PersonalAsset,
  type PersonalAssetInput,
  type ValuationSettingsFields,
  type ViewMode,
} from "../api";
import {
  AssetValueChart,
  OTHER_COLOR,
  SERIES_COLORS,
  type ChartSeries,
} from "../components/AssetValueChart";
import { AccountPickerModal } from "../components/CategoryPickerModal";
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
import {
  asOfDateLabel,
  BUILDING_LIFE_YEARS,
  BUILDING_STRUCTURE_LABEL,
  BUILDING_STRUCTURES,
  describeRule,
  resolveRule,
  TREND_LABEL,
  trendOf,
  VALUATION_METHOD_LABEL,
  VALUATION_METHODS,
  type AssetCategory,
  type BuildingStructure,
  type ValuationMethod,
  type ValueTrend,
} from "../shared/asset-valuation";
import { displayName } from "../shared/display-name";
import { ASSETS_HELP, textFor } from "../shared/help-texts";
import { digitsOnly, yenShort } from "../format";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "../shared/labels";

const CATEGORY_OPTIONS = (
  Object.keys(PERSONAL_ASSET_CATEGORY_LABEL) as PersonalAssetCategory[]
).map((value) => ({
  value,
  label: PERSONAL_ASSET_CATEGORY_LABEL[value],
}));
const METHOD_OPTIONS = VALUATION_METHODS.map((value) => ({
  value,
  label: VALUATION_METHOD_LABEL[value],
}));
const STRUCTURE_OPTIONS: { value: BuildingStructure | ""; label: string }[] = [
  { value: "", label: "木造（既定）" },
  ...BUILDING_STRUCTURES.map((b) => ({
    value: b,
    label: `${BUILDING_STRUCTURE_LABEL[b]}（${BUILDING_LIFE_YEARS[b]}年）`,
  })),
];
const TREND_ICON: Record<ValueTrend, string> = { up: "↗", down: "↘", flat: "→" };

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const str = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));

// 価値の変わり方の入力（資産・内訳で共通。画面では文字列で持つ）
type ValuationForm = {
  valuationMethod: ValuationMethod;
  valuationRate: string;
  usefulLifeYears: string;
  buildingStructure: BuildingStructure | "";
};
const valuationFormOf = (v?: ValuationSettingsFields): ValuationForm => ({
  valuationMethod: v?.valuationMethod ?? "auto",
  valuationRate: str(v?.valuationRate ?? null),
  usefulLifeYears: str(v?.usefulLifeYears ?? null),
  buildingStructure: v?.buildingStructure ?? "",
});
const valuationPayload = (v: ValuationForm) => ({
  valuationMethod: v.valuationMethod,
  valuationRate: numOrNull(v.valuationRate),
  usefulLifeYears: numOrNull(v.usefulLifeYears),
  buildingStructure: v.buildingStructure || null,
});
/** 年率の入力が意味を持つか（年率・定率、自動の土地・金・投資） */
const usesRate = (category: PersonalAssetCategory, method: ValuationMethod) =>
  method === "rate" ||
  method === "declining" ||
  (method === "auto" && ["LAND", "GOLD", "SECURITIES"].includes(category));

// 内訳の入力
type PartForm = ValuationForm & {
  id?: number;
  key: string;
  name: string;
  category: PersonalAssetCategory;
  acquisitionCost: string;
  currentValue: string;
};
let partKey = 0;
const newPart = (name: string, category: PersonalAssetCategory): PartForm => ({
  key: `new-${++partKey}`,
  name,
  category,
  acquisitionCost: "",
  currentValue: "",
  ...valuationFormOf(),
});

// 登録・編集フォーム（数値は文字列で持ち、年利は画面では「％」で入力して API へは小数で送る）
type AssetForm = ValuationForm & {
  id: number | null; // null = 新規
  /** 編集前に内訳があったか（内訳をやめたら空の配列を送る） */
  hadParts: boolean;
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
  /** 内訳（null = 内訳を分けない） */
  parts: PartForm[] | null;
};

const BLANK_FORM: AssetForm = {
  id: null,
  hadParts: false,
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
  parts: null,
  ...valuationFormOf(),
};

function toForm(a: PersonalAsset): AssetForm {
  return {
    id: a.id,
    hadParts: a.parts.length > 0,
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
    ...valuationFormOf(a),
    parts:
      a.parts.length > 0
        ? a.parts.map((p) => ({
            id: p.id,
            key: `part-${p.id}`,
            name: p.name,
            category: p.category,
            acquisitionCost: str(p.acquisitionCost),
            currentValue: str(p.currentValue),
            ...valuationFormOf(p),
          }))
        : null,
  };
}

function toInput(f: AssetForm): PersonalAssetInput {
  const linked = f.linkedAccountId !== null;
  return {
    name: f.name.trim(),
    category: f.category,
    acquiredOn: f.acquiredOn || null,
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
    // 内訳があれば評価額・取得価格は内訳の合計（サーバーで計算する）
    ...(f.parts
      ? {
          acquisitionCost: null,
          parts: f.parts.map((p) => ({
            ...(p.id !== undefined && f.id !== null && { id: p.id }),
            name: p.name.trim(),
            category: p.category,
            acquisitionCost: numOrNull(p.acquisitionCost),
            currentValue: Number(p.currentValue),
            ...valuationPayload(p),
          })),
        }
      : {
          acquisitionCost: numOrNull(f.acquisitionCost),
          currentValue: Number(f.currentValue),
          ...valuationPayload(f),
          ...(f.hadParts && { parts: [] }),
        }),
  };
}

function TrendBadge({ trend }: { trend: ValueTrend }) {
  return (
    <Text style={s.trendBadge}>
      {TREND_ICON[trend]} {TREND_LABEL[trend]}
    </Text>
  );
}

// 価値の変わり方の入力欄。選んだ内容で、どう見積もるかの説明を出す
function ValuationFields({
  category,
  value,
  onChange,
}: {
  category: PersonalAssetCategory;
  value: ValuationForm;
  onChange: (v: ValuationForm) => void;
}) {
  const set = (patch: Partial<ValuationForm>) => onChange({ ...value, ...patch });
  const settings = {
    category: category as AssetCategory,
    method: value.valuationMethod,
    ratePercent: numOrNull(value.valuationRate),
    usefulLifeYears: numOrNull(value.usefulLifeYears),
    structure: value.buildingStructure || null,
  };
  const rule = resolveRule(settings);
  const showStructure =
    category === "BUILDING" &&
    (value.valuationMethod === "auto" || value.valuationMethod === "straight_line");
  return (
    <View style={s.valuationBox}>
      <Field label="価値の変わり方">
        <Pills
          scroll={false}
          options={METHOD_OPTIONS}
          value={value.valuationMethod}
          onChange={(valuationMethod) => set({ valuationMethod })}
        />
      </Field>
      {showStructure && (
        <Field label="建物の構造">
          <Pills
            scroll={false}
            options={STRUCTURE_OPTIONS}
            value={value.buildingStructure}
            onChange={(buildingStructure) => set({ buildingStructure })}
          />
        </Field>
      )}
      {usesRate(category, value.valuationMethod) && (
        <Field
          label={
            value.valuationMethod === "declining"
              ? "年の下落率（％）"
              : "年率（％・マイナスで下落）"
          }
        >
          <Input
            keyboardType="numbers-and-punctuation"
            value={value.valuationRate}
            placeholder={value.valuationMethod === "declining" ? "20" : "0"}
            onChangeText={(valuationRate) => set({ valuationRate })}
          />
        </Field>
      )}
      {value.valuationMethod === "straight_line" && (
        <Field label="耐用年数（年）">
          <Input
            keyboardType="number-pad"
            value={value.usefulLifeYears}
            placeholder={showStructure ? "構造から" : "22"}
            onChangeText={(t) => set({ usefulLifeYears: digitsOnly(t) })}
          />
        </Field>
      )}
      <Text style={s.muted}>
        見積もり: {describeRule(rule, settings)}（{TREND_LABEL[trendOf(rule)]}）
      </Text>
    </View>
  );
}

/** 内訳を系列に直す（4 つ目からは「その他」にまとめる） */
function partSeries(parts: AssetTrendSeries[]): ChartSeries[] {
  const head = parts.slice(0, SERIES_COLORS.length).map((p, i) => ({
    key: `p${p.id}`,
    label: p.name,
    color: SERIES_COLORS[i],
    values: p.series,
  }));
  const rest = parts.slice(SERIES_COLORS.length);
  if (rest.length === 0) return head;
  const values = rest[0].series.map((_, i) =>
    rest.every((p) => p.series[i] === null)
      ? null
      : rest.reduce((sum, p) => sum + (p.series[i] ?? 0), 0),
  );
  return [...head, { key: "other", label: "その他", color: OTHER_COLOR, values }];
}

/** 1 年後の見積もりと今月を比べた向き */
function trendOfSeries(trend: AssetTrend, values: (number | null)[]): ValueTrend {
  const i = trend.months.indexOf(trend.currentKey);
  const now = values[i];
  const later = values[Math.min(i + 12, values.length - 1)];
  if (i < 0 || now === null || later === null || Math.abs(later - now) < 1) return "flat";
  return later > now ? "up" : "down";
}

/** 最後の評価額の記録（手で入れた値、または価値の変わり方を変えたときの見積もり） */
const lastValuedText = (value: number | string, on: string | null) =>
  on ? `${on} 時点の評価額 ${yenShort(Number(value))}` : `評価額 ${yenShort(Number(value))}`;

type Props = { viewMode: ViewMode };

export function AssetsScreen({ viewMode }: Props) {
  const [trend, setTrend] = useState<AssetTrend | null>(null);
  const [assets, setAssets] = useState<PersonalAsset[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingDebt, setPickingDebt] = useState(false);
  // 評価額の入れ直し（資産そのもの、または内訳）
  const [editValue, setEditValue] = useState<{
    assetId: number;
    partId?: number;
    value: string;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tr, pa, accs] = await Promise.all([
        fetchAssetTrend(),
        fetchPersonalAssets(),
        fetchAccounts(),
      ]);
      setTrend(tr);
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

  // 評価額を入れ直す（入れた値から先を見積もり直す）。内訳は全件を送り、変えた内訳だけ差し替える
  function saveValue(a: PersonalAsset, partId: number | undefined, value: number) {
    run(() =>
      partId === undefined
        ? patchPersonalAsset(a.id, { currentValue: value })
        : patchPersonalAsset(a.id, {
            parts: a.parts.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
              acquisitionCost: p.acquisitionCost === null ? null : Number(p.acquisitionCost),
              currentValue: p.id === partId ? value : Number(p.currentValue),
            })),
          }),
    );
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setFormError("資産名は必須です。");
    if (form.parts) {
      if (
        form.parts.length === 0 ||
        form.parts.some((p) => !p.name.trim() || p.currentValue === "")
      )
        return setFormError("内訳ごとに名前と現在評価額を入れてください。");
    } else if (form.currentValue === "") return setFormError("現在評価額は必須です。");
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

  // 内訳を分ける・やめる（やめるときは内訳の合計を資産の評価額・取得価格に引き継ぐ）
  function toggleParts(on: boolean) {
    if (!form) return;
    if (on) {
      setForm({ ...form, parts: [newPart("土地", "LAND"), newPart("建物", "BUILDING")] });
      return;
    }
    const parts = form.parts ?? [];
    const total = parts.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0);
    const cost = parts.reduce((sum, p) => sum + (Number(p.acquisitionCost) || 0), 0);
    setForm({
      ...form,
      parts: null,
      currentValue: total > 0 ? String(total) : form.currentValue,
      acquisitionCost: cost > 0 ? String(cost) : form.acquisitionCost,
    });
  }
  const setPart = (key: string, patch: Partial<PartForm>) =>
    form &&
    setForm({
      ...form,
      parts: form.parts && form.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    });

  const liabilityAccounts = accounts.filter((a) => a.category === "LIABILITY");
  const debtLabel = (id: number | null) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "なし";
  };
  const total = assets
    .filter((a) => a.countAsAsset)
    .reduce((sum, a) => sum + (a.estimatedValue ?? Number(a.currentValue)), 0);
  const totalDebt = assets.reduce((sum, a) => sum + (a.debtRemaining ?? 0), 0);
  const hasExcluded = assets.some((a) => !a.countAsAsset);
  // いつ時点の金額か（資産管理の数字はどれも今日の見積もり）
  const asOf = asOfDateLabel(new Date());
  // 合計は今日の見積もり（総資産サマリの今月の実物資産と同じ数字）
  const trendTotalNow = trend
    ? trend.assets
        .filter((a) => a.countAsAsset && a.estimatedValue !== null)
        .reduce<number | null>((sum, a) => (sum ?? 0) + (a.estimatedValue ?? 0), null)
    : null;

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#4f46e5" size="large" />
      </View>
    );
  }

  const renderValueEditor = (
    a: PersonalAsset,
    partId: number | undefined,
    current: number | string,
  ) =>
    editValue && editValue.assetId === a.id && editValue.partId === partId ? (
      <View style={s.valueEdit}>
        <Input
          autoFocus
          keyboardType="number-pad"
          value={editValue.value}
          onChangeText={(t) => setEditValue({ ...editValue, value: digitsOnly(t) })}
          style={s.valueInput}
        />
        <Button
          small
          label="✓"
          onPress={() => {
            const value = Number(editValue.value);
            setEditValue(null);
            if (editValue.value !== "") saveValue(a, partId, value);
          }}
        />
      </View>
    ) : (
      <TouchableOpacity
        onPress={() => setEditValue({ assetId: a.id, partId, value: str(current) })}
      >
        <Text style={s.link}>評価額を更新</Text>
      </TouchableOpacity>
    );

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Lead>{textFor(ASSETS_HELP.page, viewMode)}</Lead>

        {/* ── 実物資産の評価額の推移（合計と資産ごと。今月より先は破線の見積もり）── */}
        {trend && trend.assets.length > 0 && (
          <Card>
            <SectionTitle note={ASSETS_HELP.trend}>実物資産の評価額の推移</SectionTitle>
            <View style={s.trendHead}>
              <View>
                <Text style={s.muted}>合計（資産計上の資産・{asOf}）</Text>
                <Text style={s.totalValue}>
                  {trendTotalNow === null ? "—" : yenShort(trendTotalNow)}
                </Text>
              </View>
              <TrendBadge trend={trendOfSeries(trend, trend.total)} />
            </View>
            <AssetValueChart
              months={trend.months}
              currentKey={trend.currentKey}
              series={[
                { key: "total", label: "合計", color: SERIES_COLORS[0], values: trend.total },
              ]}
              height={180}
            />
            <Text style={s.subTitle}>資産ごとの推移</Text>
            {trend.assets.map((a) => (
              <View key={a.id} style={s.trendItem}>
                <View style={s.assetHead}>
                  <Text style={s.categoryBadge}>
                    {PERSONAL_ASSET_CATEGORY_LABEL[a.category] ?? a.category}
                  </Text>
                  <Text style={s.assetName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <TrendBadge trend={trendOfSeries(trend, a.series)} />
                </View>
                <Text style={s.muted}>
                  {asOf}の見積もり {a.estimatedValue === null ? "—" : yenShort(a.estimatedValue)}
                  {a.countAsAsset ? "" : " ・ 資産計上外（合計に含めない）"}
                </Text>
                <AssetValueChart
                  months={trend.months}
                  currentKey={trend.currentKey}
                  series={
                    a.parts.length > 0
                      ? partSeries(a.parts)
                      : [
                          {
                            key: `a${a.id}`,
                            label: a.name,
                            color: SERIES_COLORS[0],
                            values: a.series,
                          },
                        ]
                  }
                  height={120}
                />
              </View>
            ))}
          </Card>
        )}

        {/* ── 実物資産 ── */}
        <Card>
          <SectionTitle
            note={
              `${ASSETS_HELP.personal}\n${asOf}の見積もりの合計: ${yenShort(total)}` +
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
            <EmptyText>{ASSETS_HELP.empty}</EmptyText>
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
                <View style={s.badgeRow}>
                  <TrendBadge trend={a.trend} />
                </View>
                <Text style={s.muted}>
                  {a.acquiredOn ? `取得日: ${a.acquiredOn.slice(0, 10)} ・ ` : ""}
                  {a.acquisitionCost !== null
                    ? `取得価格: ${yenShort(Number(a.acquisitionCost))} ・ `
                    : ""}
                  {a.ruleLabel ? `価値の変わり方: ${a.ruleLabel} ・ ` : ""}
                  {a.parts.length === 0 ? lastValuedText(a.currentValue, a.lastValuedOn) : ""}
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
                {/* 内訳（土地と建物など）。内訳ごとに価値の変わり方と評価額の入れ直し */}
                {a.parts.map((p) => (
                  <View key={p.id} style={s.part}>
                    <View style={s.assetHead}>
                      <Text style={s.partMark}>└</Text>
                      <Text style={s.categoryBadge}>
                        {PERSONAL_ASSET_CATEGORY_LABEL[p.category] ?? p.category}
                      </Text>
                      <Text style={s.partName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={s.partValue}>
                        {yenShort(p.estimatedValue ?? Number(p.currentValue))}
                      </Text>
                    </View>
                    <Text style={s.muted}>
                      <TrendBadge trend={p.trend} /> ・ 価値の変わり方: {p.ruleLabel} ・{" "}
                      {lastValuedText(p.currentValue, p.lastValuedOn)}
                    </Text>
                    {renderValueEditor(a, p.id, p.currentValue)}
                  </View>
                ))}
                <View style={s.assetFoot}>
                  <View>
                    <Text style={s.muted}>{asOf}の見積もり</Text>
                    <Text style={s.value}>
                      {yenShort(a.estimatedValue ?? Number(a.currentValue))}
                    </Text>
                    {a.parts.length === 0 && renderValueEditor(a, undefined, a.currentValue)}
                  </View>
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
                placeholder={form.parts ? "自宅" : "自宅土地"}
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
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchLabel}>内訳を分けて登録する（土地と建物など）</Text>
                <Text style={s.muted}>
                  ローン 1 本で土地と建物を買ったときなどに使います。資産とローンは 1
                  つのまま、内訳ごとに評価額と価値の変わり方を入れられます。
                </Text>
              </View>
              <Switch value={form.parts !== null} onValueChange={toggleParts} />
            </View>
            {form.parts ? (
              <>
                {form.parts.map((p, i) => (
                  <View key={p.key} style={s.partBox}>
                    <View style={s.partBoxHead}>
                      <Text style={s.switchLabel}>内訳 {i + 1}</Text>
                      {form.parts!.length > 1 && (
                        <TouchableOpacity
                          onPress={() =>
                            setForm({
                              ...form,
                              parts: form.parts!.filter((x) => x.key !== p.key),
                            })
                          }
                        >
                          <Text style={s.danger}>削除</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Field label="内訳名 *">
                      <Input value={p.name} onChangeText={(name) => setPart(p.key, { name })} />
                    </Field>
                    <Field label="種別">
                      <Pills
                        scroll={false}
                        options={CATEGORY_OPTIONS}
                        value={p.category}
                        onChange={(category) => setPart(p.key, { category })}
                      />
                    </Field>
                    <Field label="取得価格（円）">
                      <Input
                        keyboardType="number-pad"
                        value={p.acquisitionCost}
                        onChangeText={(t) => setPart(p.key, { acquisitionCost: digitsOnly(t) })}
                      />
                    </Field>
                    <Field label="現在評価額（円） *">
                      <Input
                        keyboardType="number-pad"
                        value={p.currentValue}
                        onChangeText={(t) => setPart(p.key, { currentValue: digitsOnly(t) })}
                      />
                    </Field>
                    <ValuationFields
                      category={p.category}
                      value={p}
                      onChange={(v) => setPart(p.key, v)}
                    />
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() =>
                    setForm({ ...form, parts: [...(form.parts ?? []), newPart("", "OTHER")] })
                  }
                  style={{ marginBottom: 8 }}
                >
                  <Text style={s.link}>+ 内訳を追加</Text>
                </TouchableOpacity>
                <Text style={s.muted}>
                  合計: 取得価格{" "}
                  {yenShort(
                    form.parts.reduce((sum, p) => sum + (Number(p.acquisitionCost) || 0), 0),
                  )}{" "}
                  ・ 現在評価額{" "}
                  {yenShort(form.parts.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0))}
                </Text>
              </>
            ) : (
              <>
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
                <ValuationFields
                  category={form.category}
                  value={form}
                  onChange={(v) => setForm({ ...form, ...v })}
                />
              </>
            )}
            <Text style={s.muted}>{ASSETS_HELP.valuation}</Text>
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
  trendHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  totalValue: { fontSize: 20, fontWeight: "700", color: "#1e293b" },
  subTitle: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 12, marginBottom: 6 },
  trendItem: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 8, marginTop: 8 },
  trendBadge: {
    fontSize: 10,
    color: "#475569",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  badgeRow: { flexDirection: "row", marginTop: 4 },
  part: {
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 6,
    marginTop: 6,
    paddingLeft: 8,
  },
  partMark: { fontSize: 12, color: "#cbd5e1" },
  partName: { flex: 1, fontSize: 13, color: "#334155" },
  partValue: { fontSize: 13, fontWeight: "600", color: "#334155" },
  partBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  partBoxHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  valuationBox: { backgroundColor: "#f8fafc", borderRadius: 8, padding: 10, marginBottom: 8 },
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
