"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AssetTrendCharts, TrendBadge } from "@/components/AssetTrendCharts";
import { SectionLead } from "@/components/Explain";
import { PageHeader } from "@/components/ui";
import {
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
} from "@/lib/asset-valuation";
import { ASSETS_HELP, textFor } from "@/lib/help-texts";
import { isCountedAsAsset } from "@/lib/personal-asset";
import { useViewMode } from "@/lib/use-view-mode";
import { displayName } from "@/lib/display-name";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "@/lib/labels";

type ValueTrend = "up" | "down" | "flat";
type PersonalAssetPart = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquisitionCost: number | string | null;
  currentValue: number | string;
  valuationMethod: ValuationMethod;
  valuationRate: number | string | null;
  usefulLifeYears: number | null;
  buildingStructure: BuildingStructure | null;
  /** 今日の時点の評価額の見積もり */
  estimatedValue: number | null;
  trend: ValueTrend;
  ruleLabel: string;
  /** 最後に評価額を入れた日（YYYY-MM-DD） */
  lastValuedOn: string | null;
};
type PersonalAsset = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: number | string | null;
  currentValue: number | string;
  /** 純資産に評価額を計上するか。false = 負債のみ反映（ローンの諸費用等） */
  countAsAsset: boolean;
  note: string | null;
  linkedAccountId: number | null;
  debtStartOn: string | null;
  debtPayoffDue: string | null;
  debtInitialAmount: number | string | null;
  /** 年利（小数。0.0081 = 0.810%） */
  debtInterestRate: number | string | null;
  /** 残価設定ローンの据置額（最終回に一括支払い）。null / 0 = 通常ローン */
  debtResidualValue: number | string | null;
  debtMonthly: number | null;
  debtRemaining: number | null;
  debtRemainingMonths: number | null;
  valuationMethod: ValuationMethod;
  valuationRate: number | string | null;
  usefulLifeYears: number | null;
  buildingStructure: BuildingStructure | null;
  /** 今日の時点の評価額の見積もり（内訳があれば内訳の合計） */
  estimatedValue: number | null;
  trend: ValueTrend;
  /** 価値の変わり方の説明（内訳がある資産は null。内訳ごとに出す） */
  ruleLabel: string | null;
  lastValuedOn: string | null;
  /** 内訳（住宅ローン 1 本で買った土地と建物など）。無ければ空 */
  parts: PersonalAssetPart[];
  createdAt: string;
  updatedAt: string;
};
type AccountRef = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

const str = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

// 価値の変わり方の入力（資産・内訳で共通。画面では文字列で持つ）
type ValuationForm = {
  valuationMethod: ValuationMethod;
  valuationRate: string;
  usefulLifeYears: string;
  buildingStructure: BuildingStructure | "";
};
const valuationFormOf = (v?: {
  valuationMethod: ValuationMethod;
  valuationRate: number | string | null;
  usefulLifeYears: number | null;
  buildingStructure: BuildingStructure | null;
}): ValuationForm => ({
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

// 価値の変わり方の入力欄。選んだ内容で、どう見積もるかの説明を出す
function ValuationFields({
  category,
  value,
  onChange,
  idPrefix,
}: {
  category: PersonalAssetCategory;
  value: ValuationForm;
  onChange: (v: ValuationForm) => void;
  idPrefix: string;
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
    <div className="rounded-lg bg-slate-50 px-3 py-2 space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <label className="block" htmlFor={`${idPrefix}-method`}>
          <span className="text-xs font-medium text-slate-600">価値の変わり方</span>
          <select
            id={`${idPrefix}-method`}
            className="input-field mt-1 w-full"
            value={value.valuationMethod}
            onChange={(e) => set({ valuationMethod: e.target.value as ValuationMethod })}
          >
            {VALUATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {VALUATION_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {showStructure && (
          <label className="block" htmlFor={`${idPrefix}-structure`}>
            <span className="text-xs font-medium text-slate-600">建物の構造</span>
            <select
              id={`${idPrefix}-structure`}
              className="input-field mt-1 w-full"
              value={value.buildingStructure}
              onChange={(e) => set({ buildingStructure: e.target.value as BuildingStructure | "" })}
            >
              <option value="">木造（既定）</option>
              {BUILDING_STRUCTURES.map((b) => (
                <option key={b} value={b}>
                  {BUILDING_STRUCTURE_LABEL[b]}（{BUILDING_LIFE_YEARS[b]}年）
                </option>
              ))}
            </select>
          </label>
        )}
        {usesRate(category, value.valuationMethod) && (
          <label className="block" htmlFor={`${idPrefix}-rate`}>
            <span className="text-xs font-medium text-slate-600">
              {value.valuationMethod === "declining"
                ? "年の下落率（％）"
                : "年率（％・マイナスで下落）"}
            </span>
            <input
              id={`${idPrefix}-rate`}
              type="number"
              step="0.1"
              className="input-field mt-1 w-full"
              placeholder={value.valuationMethod === "declining" ? "20" : "0"}
              value={value.valuationRate}
              onChange={(e) => set({ valuationRate: e.target.value })}
            />
          </label>
        )}
        {value.valuationMethod === "straight_line" && (
          <label className="block" htmlFor={`${idPrefix}-life`}>
            <span className="text-xs font-medium text-slate-600">耐用年数（年）</span>
            <input
              id={`${idPrefix}-life`}
              type="number"
              min={1}
              className="input-field mt-1 w-full"
              placeholder={showStructure ? "構造から" : "22"}
              value={value.usefulLifeYears}
              onChange={(e) => set({ usefulLifeYears: e.target.value })}
            />
          </label>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        見積もり: {describeRule(rule, settings)}（{TREND_LABEL[trendOf(rule)]}）
      </p>
    </div>
  );
}

// 内訳の入力（画面では文字列で持つ）
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

// 実物資産の登録・編集（asset を渡すと編集。モバイル版 AssetsScreen の登録・編集シートと同じ項目）
function PersonalAssetFormModal({
  asset,
  onClose,
}: {
  asset?: PersonalAsset;
  onClose: () => void;
}) {
  const sysMode = useViewMode();
  const invalidate = useInvalidateAssets();
  const [form, setForm] = useState({
    name: asset?.name ?? "",
    category: (asset?.category ?? "LAND") as PersonalAssetCategory,
    acquiredOn: asset?.acquiredOn?.slice(0, 10) ?? "",
    acquisitionCost: str(asset?.acquisitionCost ?? null),
    currentValue: str(asset?.currentValue ?? null),
    countAsAsset: asset?.countAsAsset ?? true,
    note: asset?.note ?? "",
    linkedAccountId: str(asset?.linkedAccountId ?? null),
    debtStartOn: asset?.debtStartOn?.slice(0, 7) ?? "",
    debtPayoffDue: asset?.debtPayoffDue?.slice(0, 7) ?? "",
    debtInitialAmount: str(asset?.debtInitialAmount ?? null),
    // 画面は「％」で入力し、API へは小数（0.810 → 0.0081）に直して送る
    debtInterestPercent:
      asset?.debtInterestRate != null
        ? String(Number((Number(asset.debtInterestRate) * 100).toPrecision(6)))
        : "",
    // 残価設定ローン（カーローン等）の据置額。最終回に一括で支払う
    debtResidualValue: str(asset?.debtResidualValue ?? null),
  });
  const [valuation, setValuation] = useState<ValuationForm>(() => valuationFormOf(asset));
  // 内訳（住宅ローン 1 本で買った土地と建物など）。null = 内訳を分けない
  const [parts, setParts] = useState<PartForm[] | null>(() =>
    asset && asset.parts.length > 0
      ? asset.parts.map((p) => ({
          id: p.id,
          key: `part-${p.id}`,
          name: p.name,
          category: p.category,
          acquisitionCost: str(p.acquisitionCost),
          currentValue: str(p.currentValue),
          ...valuationFormOf(p),
        }))
      : null,
  );
  const isEdit = asset !== undefined;

  const { data: liabilityAccounts } = useQuery({
    queryKey: ["accounts", "LIABILITY"],
    queryFn: async (): Promise<AccountRef[]> => {
      const json = await (await fetch("/api/accounts")).json();
      return ((json.data ?? []) as AccountRef[]).filter((a) => a.category === "LIABILITY");
    },
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = (k: keyof typeof form, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const setPart = (key: string, patch: Partial<PartForm>) =>
    setParts((ps) => ps && ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function toggleParts(on: boolean) {
    if (!on) {
      // 内訳をやめるときは、内訳の合計を資産の評価額・取得価格に引き継ぐ
      if (parts) {
        const total = parts.reduce((s, p) => s + (Number(p.currentValue) || 0), 0);
        const cost = parts.reduce((s, p) => s + (Number(p.acquisitionCost) || 0), 0);
        setForm((p) => ({
          ...p,
          currentValue: total > 0 ? String(total) : p.currentValue,
          acquisitionCost: cost > 0 ? String(cost) : p.acquisitionCost,
        }));
      }
      setParts(null);
      return;
    }
    setParts([newPart("土地", "LAND"), newPart("建物", "BUILDING")]);
  }

  const partsTotal = (parts ?? []).reduce((s, p) => s + (Number(p.currentValue) || 0), 0);
  const partsCost = (parts ?? []).reduce((s, p) => s + (Number(p.acquisitionCost) || 0), 0);

  async function submit() {
    if (!form.name) {
      setError("資産名は必須です。");
      return;
    }
    if (parts) {
      if (parts.length === 0 || parts.some((p) => !p.name || p.currentValue === "")) {
        setError("内訳ごとに名前と現在評価額を入れてください。");
        return;
      }
    } else if (!form.currentValue) {
      setError("現在評価額は必須です。");
      return;
    }
    if (form.debtStartOn && form.debtPayoffDue && form.debtStartOn > form.debtPayoffDue) {
      setError("支払い開始年月は解消予定年月以前にしてください。");
      return;
    }
    setSaving(true);
    setError(null);
    // 未入力の項目は、登録では送らず（サーバー既定値）、編集では null で送って消す
    const empty = isEdit ? null : undefined;
    const linked = form.linkedAccountId !== "";
    const res = await fetch(isEdit ? `/api/personal-assets/${asset.id}` : "/api/personal-assets", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        acquiredOn: form.acquiredOn || empty,
        countAsAsset: form.countAsAsset,
        note: form.note || empty,
        linkedAccountId: linked ? Number(form.linkedAccountId) : empty,
        // 負債の項目は紐付け負債科目があるときだけ意味を持つ
        debtStartOn: (linked && form.debtStartOn) || empty,
        debtPayoffDue: (linked && form.debtPayoffDue) || empty,
        debtInitialAmount:
          linked && form.debtInitialAmount ? Number(form.debtInitialAmount) : empty,
        debtInterestRate:
          linked && form.debtInterestPercent ? Number(form.debtInterestPercent) / 100 : empty,
        debtResidualValue:
          linked && form.debtResidualValue ? Number(form.debtResidualValue) : empty,
        // 内訳があれば評価額・取得価格は内訳の合計（サーバーで計算する）
        ...(parts
          ? {
              parts: parts.map((p) => ({
                ...(p.id !== undefined && isEdit && { id: p.id }),
                name: p.name,
                category: p.category,
                acquisitionCost: numOrNull(p.acquisitionCost),
                currentValue: Number(p.currentValue),
                ...valuationPayload(p),
              })),
            }
          : {
              acquisitionCost: form.acquisitionCost ? Number(form.acquisitionCost) : empty,
              currentValue: Number(form.currentValue),
              ...valuationPayload(valuation),
              // 編集で内訳をやめたとき
              ...(isEdit && asset.parts.length > 0 && { parts: [] }),
            }),
      }),
    });
    if (res.ok) {
      invalidate();
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  return (
    // 画面が低いと入力欄が枠外に出るため、オーバーレイ側で縦スクロールできるようにする
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-[560px] my-auto p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          {isEdit ? "実物資産 編集" : "実物資産 登録"}
        </h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">資産名 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.name}
              onChange={(e) => f("name", e.target.value)}
              placeholder={parts ? "自宅" : "自宅土地"}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">種別</span>
              <select
                className="input-field mt-1 w-full"
                value={form.category}
                onChange={(e) => f("category", e.target.value)}
              >
                {Object.entries(PERSONAL_ASSET_CATEGORY_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取得日</span>
              <input
                type="date"
                className="input-field mt-1 w-full"
                value={form.acquiredOn}
                onChange={(e) => f("acquiredOn", e.target.value)}
              />
            </label>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={parts !== null}
              onChange={(e) => toggleParts(e.target.checked)}
            />
            <span className="text-xs text-slate-600">
              内訳を分けて登録する（土地と建物など）
              <span className="mt-0.5 block text-[10px] text-slate-400">
                ローン 1 本で土地と建物を買ったときなどに使います。資産とローンは 1
                つのまま、内訳ごとに評価額と価値の変わり方を入れられます
              </span>
            </span>
          </label>

          {parts ? (
            <div className="space-y-3">
              {parts.map((p, i) => (
                <div key={p.key} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">内訳 {i + 1}</span>
                    {parts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setParts((ps) => ps && ps.filter((x) => x.key !== p.key))}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        削除
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">内訳名 *</span>
                      <input
                        className="input-field mt-1 w-full"
                        value={p.name}
                        onChange={(e) => setPart(p.key, { name: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">種別</span>
                      <select
                        className="input-field mt-1 w-full"
                        value={p.category}
                        onChange={(e) =>
                          setPart(p.key, { category: e.target.value as PersonalAssetCategory })
                        }
                      >
                        {Object.entries(PERSONAL_ASSET_CATEGORY_LABEL).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">取得価格（円）</span>
                      <input
                        type="number"
                        min={0}
                        className="input-field mt-1 w-full"
                        value={p.acquisitionCost}
                        onChange={(e) => setPart(p.key, { acquisitionCost: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">現在評価額（円） *</span>
                      <input
                        type="number"
                        min={0}
                        className="input-field mt-1 w-full"
                        value={p.currentValue}
                        onChange={(e) => setPart(p.key, { currentValue: e.target.value })}
                      />
                    </label>
                  </div>
                  <ValuationFields
                    idPrefix={`part-${p.key}`}
                    category={p.category}
                    value={p}
                    onChange={(v) => setPart(p.key, v)}
                  />
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setParts((ps) => [...(ps ?? []), newPart("", "OTHER")])}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  + 内訳を追加
                </button>
                <span className="text-xs text-slate-500">
                  合計: 取得価格 {yen(partsCost)} ・ 現在評価額 {yen(partsTotal)}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">取得価格（円）</span>
                  <input
                    type="number"
                    className="input-field mt-1 w-full"
                    value={form.acquisitionCost}
                    onChange={(e) => f("acquisitionCost", e.target.value)}
                    min={0}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">現在評価額（円） *</span>
                  <input
                    type="number"
                    className="input-field mt-1 w-full"
                    value={form.currentValue}
                    onChange={(e) => f("currentValue", e.target.value)}
                    min={0}
                  />
                </label>
              </div>
              <ValuationFields
                idPrefix="asset"
                category={form.category}
                value={valuation}
                onChange={setValuation}
              />
            </>
          )}
          <p className="text-[10px] text-slate-400">{ASSETS_HELP.valuation}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">紐付け負債科目（ローン等）</span>
              <select
                className="input-field mt-1 w-full"
                value={form.linkedAccountId}
                onChange={(e) => f("linkedAccountId", e.target.value)}
              >
                <option value="">なし</option>
                {(liabilityAccounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {displayName(a, sysMode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">当初負債額（円）</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.debtInitialAmount}
                onChange={(e) => f("debtInitialAmount", e.target.value)}
                min={0}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">年利（％）</span>
              <input
                type="number"
                step="0.001"
                min={0}
                placeholder="例: 0.810"
                className="input-field mt-1 w-full"
                value={form.debtInterestPercent}
                onChange={(e) => f("debtInterestPercent", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">支払い開始年月</span>
              <input
                type="month"
                className="input-field mt-1 w-full"
                value={form.debtStartOn}
                onChange={(e) => f("debtStartOn", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">残価（円）</span>
              <input
                type="number"
                min={0}
                placeholder="残価設定ローンのみ"
                className="input-field mt-1 w-full"
                value={form.debtResidualValue}
                onChange={(e) => f("debtResidualValue", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">負債解消（完済）予定年月</span>
              <input
                type="month"
                className="input-field mt-1 w-full"
                value={form.debtPayoffDue}
                onChange={(e) => f("debtPayoffDue", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
          </div>
          <p className="text-[10px] text-slate-400">
            当初負債額・開始年月・解消予定年月を設定すると、開始月〜解消予定月の毎月の返済額を予算に自動計上し、負債残高を算出して表示します。年利を入力すると元利均等返済で計算します（未入力は無利子＝元本の月割り）。残価設定ローン（カーローン等）は残価を入力すると、最終回に残価を一括で支払う前提で月額と残高を計算します
          </p>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.countAsAsset}
              onChange={(e) => f("countAsAsset", e.target.checked)}
            />
            <span className="text-xs text-slate-600">
              純資産に評価額を計上する
              <span className="mt-0.5 block text-[10px] text-slate-400">
                ローンに含まれる登記費用・手数料など、借入はあるが資産価値を持たない項目はオフにしてください。オフにすると負債だけが純資産に反映されます
              </span>
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">備考</span>
            <input
              className="input-field mt-1 w-full"
              value={form.note}
              onChange={(e) => f("note", e.target.value)}
            />
          </label>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            キャンセル
          </button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary">
            {saving ? "保存中…" : isEdit ? "保存" : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 評価額・資産計上・負債は、推移と総資産サマリ（ダッシュボード）の元データでもあるので一緒に取り直す
function useInvalidateAssets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["personal-assets"] });
    qc.invalidateQueries({ queryKey: ["personal-assets-trend"] });
    qc.invalidateQueries({ queryKey: ["assets-summary"] });
  };
}

// 評価額を手で入れ直す欄（押すと入力になり、Enter か ✓ で保存。保存した値から先を見積もり直す）
function ValueEditor({
  value,
  label,
  onSave,
}: {
  value: number | string;
  label: string;
  onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setText(String(Number(value)));
        }}
        className="text-[11px] text-indigo-500 hover:text-indigo-700"
        title={`${label}の評価額を入れ直します。入れた値から先を見積もり直します`}
      >
        評価額を更新
      </button>
    );
  }
  const save = () => {
    if (text.trim() !== "" && Number(text) >= 0) onSave(Number(text));
    setEditing(false);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        autoFocus
        aria-label={`${label}の評価額`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-28 text-right text-sm border border-indigo-400 rounded px-2 py-1"
      />
      <button type="button" onClick={save} className="text-xs text-indigo-600">
        ✓
      </button>
    </span>
  );
}

/** 最後の評価額の記録（手で入れた値、または価値の変わり方を変えたときの見積もり） */
const lastValuedText = (value: number | string, on: string | null) =>
  on ? `${on} 時点の評価額 ${yen(Number(value))}` : `評価額 ${yen(Number(value))}`;

function PersonalAssetsSection() {
  const invalidateAssets = useInvalidateAssets();
  const [showModal, setShowModal] = useState(false);
  const [editAsset, setEditAsset] = useState<PersonalAsset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["personal-assets"],
    queryFn: () =>
      fetch("/api/personal-assets")
        .then((r) => r.json())
        .then((r) => (r.data ?? []) as PersonalAsset[]),
  });

  const patch = (id: number, body: Record<string, unknown>) =>
    fetch(`/api/personal-assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // 評価額の入れ直し（資産そのもの、または内訳）。内訳は全件を送り、変えた内訳だけ値を差し替える
  const valueMut = useMutation({
    mutationFn: (vars: { asset: PersonalAsset; partId?: number; value: number }) =>
      vars.partId === undefined
        ? patch(vars.asset.id, { currentValue: vars.value })
        : patch(vars.asset.id, {
            parts: vars.asset.parts.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
              acquisitionCost: p.acquisitionCost === null ? null : Number(p.acquisitionCost),
              currentValue: p.id === vars.partId ? vars.value : Number(p.currentValue),
            })),
          }),
    onSuccess: invalidateAssets,
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/personal-assets/${id}`, { method: "DELETE" }),
    onSuccess: invalidateAssets,
  });

  // 純資産に計上するかの切り替え（ローンの諸費用などを資産計上外にする）
  const countMut = useMutation({
    mutationFn: (vars: { id: number; countAsAsset: boolean }) =>
      patch(vars.id, { countAsAsset: vars.countAsAsset }),
    onSuccess: invalidateAssets,
  });

  const assets = data ?? [];
  const total = assets
    .filter(isCountedAsAsset)
    .reduce((s, a) => s + (a.estimatedValue ?? Number(a.currentValue)), 0);
  const totalDebt = assets.reduce((s, a) => s + (a.debtRemaining ?? 0), 0);
  const hasExcluded = assets.some((a) => !isCountedAsAsset(a));

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="section-title mb-1">実物資産（土地・建物・車・金など）</h2>
          <SectionLead className="mb-1">{ASSETS_HELP.personal}</SectionLead>
          <p className="text-xs text-slate-400 mt-0.5">
            今の見積もりの合計: {yen(total)}
            {totalDebt > 0 && (
              <span className="text-amber-600"> ・ 負債残高合計: {yen(totalDebt)}</span>
            )}
            {hasExcluded && <span> ・ 「資産計上外」の項目は負債のみ反映</span>}
          </p>
        </div>
        <button type="button" onClick={() => setShowModal(true)} className="btn-primary">
          + 資産を登録
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">{ASSETS_HELP.empty}</p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {PERSONAL_ASSET_CATEGORY_LABEL[a.category]}
                    </span>
                    <span className="font-medium text-slate-800 text-sm">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => countMut.mutate({ id: a.id, countAsAsset: !a.countAsAsset })}
                      disabled={countMut.isPending}
                      title={
                        isCountedAsAsset(a)
                          ? "クリックすると純資産の評価額から除外します（ローンの諸費用など）"
                          : "クリックすると純資産に評価額を計上します"
                      }
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                        isCountedAsAsset(a)
                          ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                          : "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
                      }`}
                    >
                      {isCountedAsAsset(a) ? "資産計上" : "資産計上外"}
                    </button>
                    <TrendBadge trend={a.trend} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {a.acquiredOn && <span>取得日: {a.acquiredOn.slice(0, 10)} ・ </span>}
                    {a.acquisitionCost !== null && (
                      <span>取得価格: {yen(Number(a.acquisitionCost))} ・ </span>
                    )}
                    {a.ruleLabel && <span>価値の変わり方: {a.ruleLabel} ・ </span>}
                    {a.parts.length === 0 && (
                      <span>{lastValuedText(a.currentValue, a.lastValuedOn)}</span>
                    )}
                  </div>
                  {a.debtRemaining !== null && (
                    <div className="text-xs text-amber-600 mt-0.5">
                      負債残高: {yen(a.debtRemaining)}（残り{a.debtRemainingMonths}回・月
                      {yen(a.debtMonthly ?? 0)}・年利
                      {(Number(a.debtInterestRate ?? 0) * 100).toFixed(3)}%・
                      {a.debtPayoffDue?.slice(0, 7)}解消予定）
                      {Number(a.debtResidualValue ?? 0) > 0 && (
                        <span className="block">
                          残価設定ローン: 最終回に {yen(Number(a.debtResidualValue))} を一括支払い
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">今の見積もり</p>
                    <p className="font-bold text-slate-800 text-sm tabular-nums">
                      {yen(a.estimatedValue ?? Number(a.currentValue))}
                    </p>
                    {a.parts.length === 0 && (
                      <ValueEditor
                        value={a.currentValue}
                        label={a.name}
                        onSave={(v) => valueMut.mutate({ asset: a, value: v })}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditAsset(a)}
                    className="text-xs text-indigo-500 hover:text-indigo-700"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("削除しますか？")) delMut.mutate(a.id);
                    }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    削除
                  </button>
                </div>
              </div>

              {/* 内訳（土地と建物など）。内訳ごとに価値の変わり方と評価額の入れ直し */}
              {a.parts.length > 0 && (
                <ul className="mt-2 border-t border-slate-100 pt-2 space-y-1.5">
                  {a.parts.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 pl-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-300" aria-hidden="true">
                            └
                          </span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                            {PERSONAL_ASSET_CATEGORY_LABEL[p.category]}
                          </span>
                          <span className="text-sm text-slate-700">{p.name}</span>
                          <TrendBadge trend={p.trend} />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 pl-5">
                          {p.acquisitionCost !== null && (
                            <span>取得価格: {yen(Number(p.acquisitionCost))} ・ </span>
                          )}
                          価値の変わり方: {p.ruleLabel} ・{" "}
                          {lastValuedText(p.currentValue, p.lastValuedOn)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-700 tabular-nums">
                          {yen(p.estimatedValue ?? Number(p.currentValue))}
                        </p>
                        <ValueEditor
                          value={p.currentValue}
                          label={`${a.name}の${p.name}`}
                          onSave={(v) => valueMut.mutate({ asset: a, partId: p.id, value: v })}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <PersonalAssetFormModal onClose={() => setShowModal(false)} />}
      {editAsset && <PersonalAssetFormModal asset={editAsset} onClose={() => setEditAsset(null)} />}
    </div>
  );
}

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

// 資産管理は「実物資産の評価額の推移」と「実物資産」の一覧。総資産サマリ（口座・借入金を含む純資産）は
// ダッシュボードへ移し、KPI の対象月の時点で出す（components/NetWorthSummaryCard.tsx）。
// ASSET / LIABILITY 科目の残高から作っていた KPI カードと純資産推移グラフは、家計モードでは科目側に
// 残高を積まないため常に 0 円になり、同じ数字は総資産サマリが実データから出しているため撤去済み。
export default function AssetsPage() {
  const sysMode = useViewMode();
  return (
    <AppShell>
      <PageHeader title="資産管理" lead={textFor(ASSETS_HELP.page, sysMode)} />

      <AssetTrendCharts />

      <PersonalAssetsSection />
    </AppShell>
  );
}
