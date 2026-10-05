import { z } from "zod";
import type { PersonalAsset, PersonalAssetPart, PersonalAssetValuation } from "@prisma/client";
import {
  BUILDING_STRUCTURES,
  describeRule,
  estimateValue,
  monthlyValues,
  resolveRule,
  VALUATION_METHODS,
  type AssetCategory,
  type BuildingStructure,
  type ValuationInput,
  type ValuationMethod,
  type ValuationSettings,
  type ValueTrend,
} from "@/lib/asset-valuation";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import type { TenantDbClient } from "@/lib/tenant-db";
import type { DebtSchedule } from "@/lib/debt-schedule";
import { serializeAssetWithDebt } from "@/lib/personal-asset-debt";

// 実物資産の内訳と評価額の記録を、DB の行と lib/asset-valuation.ts（計算）の間でつなぐ。
// 資産の API（/api/personal-assets）・推移（/api/personal-assets/trend）・総資産サマリが使う。

/** 価値の変わり方の入力（資産・内訳で共通） */
export const valuationFields = {
  valuationMethod: z.enum(VALUATION_METHODS).optional(),
  // 年率（%）。rate は増減率（マイナスで下落）、declining は下落率
  valuationRate: z.number().min(-100).max(100).nullable().optional(),
  usefulLifeYears: z.number().int().min(1).max(100).nullable().optional(),
  buildingStructure: z.enum(BUILDING_STRUCTURES).nullable().optional(),
};

/** 内訳の入力。id があれば既存の内訳を直し、無ければ新しく作る */
export const PartInputSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1),
  category: z.enum(PERSONAL_ASSET_CATEGORIES).default("OTHER"),
  acquisitionCost: z.number().min(0).nullable().optional(),
  currentValue: z.number().min(0),
  ...valuationFields,
});
export type PartInput = z.infer<typeof PartInputSchema>;

export type AssetWithValuation = PersonalAsset & {
  parts: (PersonalAssetPart & { valuations?: PersonalAssetValuation[] })[];
  valuations: PersonalAssetValuation[];
};

/** 資産・内訳の取得時に付けるもの（内訳の順・評価額の記録） */
export const VALUATION_INCLUDE = {
  parts: { orderBy: { sortOrder: "asc" as const } },
  valuations: { orderBy: { valuedOn: "asc" as const } },
};

type SettingsRow = Pick<
  PersonalAsset,
  "category" | "valuationMethod" | "valuationRate" | "usefulLifeYears" | "buildingStructure"
>;

export function settingsOf(row: SettingsRow): ValuationSettings {
  return {
    category: row.category as AssetCategory,
    method: (VALUATION_METHODS as readonly string[]).includes(row.valuationMethod)
      ? (row.valuationMethod as ValuationMethod)
      : "auto",
    ratePercent: row.valuationRate === null ? null : Number(row.valuationRate),
    usefulLifeYears: row.usefulLifeYears,
    structure: (BUILDING_STRUCTURES as readonly string[]).includes(row.buildingStructure ?? "")
      ? (row.buildingStructure as BuildingStructure)
      : null,
  };
}

/** 内訳の無い資産そのものの計算入力 */
export function assetInput(asset: AssetWithValuation): ValuationInput {
  return {
    ...settingsOf(asset),
    acquiredOn: asset.acquiredOn,
    acquisitionCost: asset.acquisitionCost === null ? null : Number(asset.acquisitionCost),
    valuations: asset.valuations
      .filter((v) => v.partId === null)
      .map((v) => ({ on: v.valuedOn, value: Number(v.value) })),
  };
}

/** 内訳の計算入力（取得日は親の資産と同じ） */
export function partInput(asset: AssetWithValuation, part: PersonalAssetPart): ValuationInput {
  return {
    ...settingsOf(part),
    acquiredOn: asset.acquiredOn,
    acquisitionCost: part.acquisitionCost === null ? null : Number(part.acquisitionCost),
    valuations: asset.valuations
      .filter((v) => v.partId === part.id)
      .map((v) => ({ on: v.valuedOn, value: Number(v.value) })),
  };
}

const sumNullable = (values: (number | null)[]) =>
  values.every((v) => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0);

/** date 時点の資産の評価額の見積もり（内訳があれば内訳の合計）。持っていなければ null */
export function estimateAssetValue(asset: AssetWithValuation, date: Date): number | null {
  if (asset.parts.length > 0) {
    return sumNullable(asset.parts.map((p) => estimateValue(partInput(asset, p), date)));
  }
  return estimateValue(assetInput(asset), date);
}

/** 1 年先の見積もりと比べた向き */
function trendBetween(now: number | null, later: number | null): ValueTrend {
  if (now === null || later === null) return "flat";
  const diff = later - now;
  // 1 円単位の丸めの揺れは横ばい扱い
  if (Math.abs(diff) < 1) return "flat";
  return diff > 0 ? "up" : "down";
}

const oneYearLater = (d: Date) => new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());

function lastValuedOn(valuations: PersonalAssetValuation[]): string | null {
  const last = valuations[valuations.length - 1];
  return last ? last.valuedOn.toISOString().slice(0, 10) : null;
}

/** 資産のレスポンスに足す評価の情報（今の見積もり・向き・価値の変わり方の説明・内訳） */
export function serializeValuation(asset: AssetWithValuation, now: Date = new Date()) {
  const later = oneYearLater(now);
  const own = asset.valuations.filter((v) => v.partId === null);
  const ownSettings = settingsOf(asset);
  const parts = asset.parts.map((p) => {
    const input = partInput(asset, p);
    const settings = settingsOf(p);
    const estimated = estimateValue(input, now);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      acquisitionCost: p.acquisitionCost,
      currentValue: p.currentValue,
      valuationMethod: settings.method,
      valuationRate: p.valuationRate,
      usefulLifeYears: p.usefulLifeYears,
      buildingStructure: p.buildingStructure,
      estimatedValue: estimated === null ? null : Math.round(estimated),
      trend: trendBetween(estimated, estimateValue(input, later)),
      ruleLabel: describeRule(resolveRule(settings), settings),
      lastValuedOn: lastValuedOn(asset.valuations.filter((v) => v.partId === p.id)),
    };
  });
  const estimated = estimateAssetValue(asset, now);
  return {
    estimatedValue: estimated === null ? null : Math.round(estimated),
    trend: trendBetween(estimated, estimateAssetValue(asset, later)),
    ruleLabel: parts.length > 0 ? null : describeRule(resolveRule(ownSettings), ownSettings),
    lastValuedOn: parts.length > 0 ? null : lastValuedOn(own),
    parts,
  };
}

/** 月末ごとの見積もり（資産と内訳） */
export function assetMonthlySeries(asset: AssetWithValuation, monthKeys: string[]) {
  if (asset.parts.length === 0) {
    return { series: monthlyValues(assetInput(asset), monthKeys), parts: [] };
  }
  const parts = asset.parts.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    series: monthlyValues(partInput(asset, p), monthKeys),
  }));
  const series = monthKeys.map((_, i) => sumNullable(parts.map((p) => p.series[i])));
  return { series, parts };
}

/** 今日の日付（時刻を落とす。評価額の記録の日付に使う） */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** 価値の変わり方の入力を DB の列に直す（指定の無い項目は含めない） */
export function valuationData(input: {
  valuationMethod?: ValuationMethod;
  valuationRate?: number | null;
  usefulLifeYears?: number | null;
  buildingStructure?: BuildingStructure | null;
}) {
  return {
    ...(input.valuationMethod !== undefined && { valuationMethod: input.valuationMethod }),
    ...(input.valuationRate !== undefined && { valuationRate: input.valuationRate }),
    ...(input.usefulLifeYears !== undefined && { usefulLifeYears: input.usefulLifeYears }),
    ...(input.buildingStructure !== undefined && { buildingStructure: input.buildingStructure }),
  };
}

type WriteClient = Pick<TenantDbClient, "personalAssetPart" | "personalAssetValuation">;

/**
 * 評価額を手で入れた記録を残す（今日の日付）。同じ日に入れ直したら、その日の記録を置き換える。
 * partId が null なら資産そのもの（内訳の無い資産）の記録。
 */
export async function recordValuation(
  tx: WriteClient,
  tenantId: number,
  assetId: number,
  partId: number | null,
  value: number,
) {
  const valuedOn = today();
  await tx.personalAssetValuation.deleteMany({ where: { tenantId, assetId, partId, valuedOn } });
  await tx.personalAssetValuation.create({ data: { tenantId, assetId, partId, valuedOn, value } });
}

/**
 * 内訳を入力どおりにそろえる（id のある内訳は直し、無い内訳は作り、入力に無い内訳は消す）。
 * 評価額が変わった内訳（新しい内訳を含む）は、評価額の記録も残す。
 * 戻り値は内訳の評価額と取得価格の合計（親の資産の currentValue / acquisitionCost に入れる）。
 */
export async function syncParts(
  tx: WriteClient,
  tenantId: number,
  assetId: number,
  parts: PartInput[],
  existing: PersonalAssetPart[],
) {
  const keepIds = new Set(parts.map((p) => p.id).filter((id): id is number => id !== undefined));
  const removed = existing.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
  if (removed.length > 0) {
    await tx.personalAssetPart.deleteMany({ where: { tenantId, id: { in: removed } } });
  }
  for (const [i, p] of parts.entries()) {
    const data = {
      name: p.name,
      category: p.category,
      acquisitionCost: p.acquisitionCost ?? null,
      currentValue: p.currentValue,
      sortOrder: i,
      ...valuationData(p),
    };
    const before = p.id !== undefined ? existing.find((e) => e.id === p.id) : undefined;
    if (before) {
      await tx.personalAssetPart.update({ where: { id: before.id }, data });
      if (Number(before.currentValue) !== p.currentValue) {
        await recordValuation(tx, tenantId, assetId, before.id, p.currentValue);
      }
    } else {
      const created = await tx.personalAssetPart.create({ data: { tenantId, assetId, ...data } });
      await recordValuation(tx, tenantId, assetId, created.id, p.currentValue);
    }
  }
  const costs = parts.map((p) => p.acquisitionCost ?? null);
  return {
    currentValue: parts.reduce((s, p) => s + p.currentValue, 0),
    acquisitionCost: sumNullable(costs),
  };
}

/** 負債（旧 API 契約の debt* フィールド）と評価の情報をまとめた資産のレスポンス */
export function serializeAsset(
  asset: AssetWithValuation & { loan: Parameters<typeof serializeAssetWithDebt>[0]["loan"] },
  schedule: DebtSchedule | null,
  now: Date = new Date(),
) {
  const { valuations: _valuations, ...debt } = serializeAssetWithDebt(
    asset,
    schedule,
  ) as ReturnType<typeof serializeAssetWithDebt> & { valuations?: unknown };
  return { ...debt, ...serializeValuation(asset, now) };
}
