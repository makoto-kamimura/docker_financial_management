"use client";

// 資産管理の実物資産の登録・編集のモーダルと、価値の変わり方の入力欄。

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
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
} from "@/lib/shared/asset-valuation";
import { ASSETS_HELP } from "@/lib/shared/help-texts";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "@/lib/shared/labels";
import { yenShort } from "@/lib/common/format";
import { PersonalAsset } from "@/components/assets/types";
import { useInvalidateAssets } from "@/components/assets/PersonalAssetsSection";

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
export function PersonalAssetFormModal({
  asset,
  onClose,
}: {
  asset?: PersonalAsset;
  onClose: () => void;
}) {
  const invalidate = useInvalidateAssets();
  const [form, setForm] = useState({
    name: asset?.name ?? "",
    category: (asset?.category ?? "LAND") as PersonalAssetCategory,
    acquiredOn: asset?.acquiredOn?.slice(0, 10) ?? "",
    acquisitionCost: str(asset?.acquisitionCost ?? null),
    currentValue: str(asset?.currentValue ?? null),
    countAsAsset: asset?.countAsAsset ?? true,
    note: asset?.note ?? "",
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
    setSaving(true);
    setError(null);
    // 未入力の項目は、登録では送らず（サーバー既定値）、編集では null で送って消す
    const empty = isEdit ? null : undefined;
    const res = await fetch(isEdit ? `/api/personal-assets/${asset.id}` : "/api/personal-assets", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        acquiredOn: form.acquiredOn || empty,
        countAsAsset: form.countAsAsset,
        note: form.note || empty,
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
    <Modal size="lg">
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
                合計: 取得価格 {yenShort(partsCost)} ・ 現在評価額 {yenShort(partsTotal)}
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
        {/* 借入の入力は借入金管理に集めた。ひも付いた借入があれば、表示だけ出す */}
        {isEdit && asset.loanId !== null ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            借入: {asset.loanLenderName}（残高 {yenShort(asset.debtRemaining ?? 0)}）— 借入の条件は
            <Link href={"/loans" as never} className="mx-0.5 underline text-indigo-600">
              借入金管理
            </Link>
            で編集します。
          </p>
        ) : (
          <p className="text-[10px] text-slate-400">{ASSETS_HELP.loanHint}</p>
        )}
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
    </Modal>
  );
}
