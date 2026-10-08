import { z } from "zod";
import type {
  LoanRepayment,
  PersonalAsset,
  PersonalAssetPart,
  PersonalAssetValuation,
} from "@prisma/client";
import {
  BUILDING_STRUCTURES,
  describeRule,
  estimateValue,
  monthlyValues,
  resolveRule,
  VALUATION_METHODS,
  type AssetCategory,
  type BuildingStructure,
  type ResolvedRule,
  type ValuationInput,
  type ValuationMethod,
  type ValuationSettings,
  type ValueTrend,
} from "@/lib/shared/asset-valuation";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/assets/personal-asset";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import type { DebtSchedule } from "@/lib/shared/debt-schedule";
import { serializeAssetWithDebt } from "@/lib/assets/personal-asset-debt";
import { loanBalanceAt } from "@/lib/assets/loan-balance";

// 実物資産の内訳と評価額の記録を、DB の行と lib/shared/asset-valuation.ts（計算）の間でつなぐ。
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

/** 記録に残した価値の変わり方（形が合わなければ null ＝今の設定を使う） */
function ruleOfRecord(v: PersonalAssetValuation): ResolvedRule | null {
  const r = v.rule as { kind?: string } | null;
  return r && ["fixed", "rate", "declining", "straight_line"].includes(r.kind ?? "")
    ? (r as ResolvedRule)
    : null;
}

/** 行の設定から、実際の見積もりの形を出す（評価額の記録に残す） */
export function ruleOfRow(row: SettingsRow): ResolvedRule {
  return resolveRule(settingsOf(row));
}

/** 内訳の無い資産そのものの計算入力 */
export function assetInput(asset: AssetWithValuation): ValuationInput {
  return {
    ...settingsOf(asset),
    acquiredOn: asset.acquiredOn,
    acquisitionCost: asset.acquisitionCost === null ? null : Number(asset.acquisitionCost),
    valuations: asset.valuations
      .filter((v) => v.partId === null)
      .map((v) => ({ on: v.valuedOn, value: Number(v.value), rule: ruleOfRecord(v) })),
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
      .map((v) => ({ on: v.valuedOn, value: Number(v.value), rule: ruleOfRecord(v) })),
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
 * 評価額の記録を残す（今日の日付）。同じ日に入れ直したら、その日の記録を置き換える。
 * partId が null なら資産そのもの（内訳の無い資産）の記録。
 * rule は今日から次の記録までに使う価値の変わり方（記録した時点の設定）。
 */
export async function recordValuation(
  tx: WriteClient,
  tenantId: number,
  assetId: number,
  partId: number | null,
  value: number,
  rule: ResolvedRule,
) {
  const valuedOn = today();
  await tx.personalAssetValuation.deleteMany({ where: { tenantId, assetId, partId, valuedOn } });
  await tx.personalAssetValuation.create({
    data: { tenantId, assetId, partId, valuedOn, value, rule },
  });
}

type RuleInput = {
  category?: string;
  valuationMethod?: ValuationMethod;
  valuationRate?: number | null;
  usefulLifeYears?: number | null;
  buildingStructure?: BuildingStructure | null;
};

/** 入力を当てたあとの価値の変わり方の設定（指定の無い項目は今のまま） */
function settingsAfter(before: SettingsRow, input: RuleInput): ValuationSettings {
  return settingsOf({
    category: (input.category ?? before.category) as SettingsRow["category"],
    valuationMethod: input.valuationMethod ?? before.valuationMethod,
    valuationRate:
      input.valuationRate !== undefined
        ? (input.valuationRate as unknown as SettingsRow["valuationRate"])
        : before.valuationRate,
    usefulLifeYears:
      input.usefulLifeYears !== undefined ? input.usefulLifeYears : before.usefulLifeYears,
    buildingStructure:
      input.buildingStructure !== undefined ? input.buildingStructure : before.buildingStructure,
  });
}

/** 入力を当てたあとの、実際の見積もりの形 */
export function ruleAfter(before: SettingsRow, input: RuleInput): ResolvedRule {
  return resolveRule(settingsAfter(before, input));
}

/** 価値の変わり方（自動のときは種別も含む）が、実際の見積もりの形として変わるか */
export function ruleChanged(before: SettingsRow, input: RuleInput): boolean {
  return JSON.stringify(ruleOfRow(before)) !== JSON.stringify(ruleAfter(before, input));
}

/**
 * 価値の変わり方を変える前に、今の設定での今日の見積もりを、新しい変わり方とともに記録する
 * （変更を今日から先だけに効かせ、過ぎた月の見積もりを動かさないため）。
 * 記録した値を返す（見積もれなければ null）。
 */
export async function anchorBeforeRuleChange(
  tx: WriteClient,
  tenantId: number,
  assetId: number,
  partId: number | null,
  oldInput: ValuationInput,
  newRule: ResolvedRule,
): Promise<number | null> {
  const value = estimateValue(oldInput, new Date());
  if (value === null) return null;
  const rounded = Math.round(value);
  await recordValuation(tx, tenantId, assetId, partId, rounded, newRule);
  return rounded;
}

/**
 * 内訳を入力どおりにそろえる（id のある内訳は直し、無い内訳は作り、入力に無い内訳は消す）。
 * 評価額が変わった内訳（新しい内訳を含む）は、評価額の記録も残す。
 * 評価額はそのままで価値の変わり方だけ変えた内訳は、変える前の今日の見積もりを記録する
 * （existingAsset に評価額の記録つきの今の資産を渡したとき）。
 * 戻り値は内訳の評価額と取得価格の合計（親の資産の currentValue / acquisitionCost に入れる）。
 */
export async function syncParts(
  tx: WriteClient,
  tenantId: number,
  assetId: number,
  parts: PartInput[],
  existing: PersonalAssetPart[],
  existingAsset?: AssetWithValuation,
) {
  const keepIds = new Set(parts.map((p) => p.id).filter((id): id is number => id !== undefined));
  const removed = existing.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
  if (removed.length > 0) {
    await tx.personalAssetPart.deleteMany({ where: { tenantId, id: { in: removed } } });
  }
  // 内訳ごとの最終的な評価額（変わり方を変えたときは、変える前の見積もりで記録した値）
  const values: number[] = [];
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
      const valueChanged = Number(before.currentValue) !== p.currentValue;
      const nextRule = ruleAfter(before, p);
      if (valueChanged) {
        await recordValuation(tx, tenantId, assetId, before.id, p.currentValue, nextRule);
      } else if (existingAsset && ruleChanged(before, p)) {
        const anchored = await anchorBeforeRuleChange(
          tx,
          tenantId,
          assetId,
          before.id,
          partInput(existingAsset, before),
          nextRule,
        );
        if (anchored !== null) data.currentValue = anchored;
      }
      await tx.personalAssetPart.update({ where: { id: before.id }, data });
    } else {
      const created = await tx.personalAssetPart.create({ data: { tenantId, assetId, ...data } });
      await recordValuation(tx, tenantId, assetId, created.id, p.currentValue, ruleOfRow(created));
    }
    values.push(data.currentValue);
  }
  const costs = parts.map((p) => p.acquisitionCost ?? null);
  return {
    currentValue: values.reduce((s, v) => s + v, 0),
    acquisitionCost: sumNullable(costs),
  };
}

/**
 * 負債（旧 API 契約の debt* フィールド）と評価の情報をまとめた資産のレスポンス。
 * 負債残高は借入金管理と同じ計算（lib/assets/loan-balance.ts。返済の記録があれば記録から、無ければ返済予定から）。
 * 借入の入力は借入金管理に集めたので、画面向けに借入の id と借入先名も付ける。
 */
export function serializeAsset(
  asset: AssetWithValuation & {
    loan:
      | (NonNullable<Parameters<typeof serializeAssetWithDebt>[0]["loan"]> & {
          repayments?: Pick<LoanRepayment, "repaidOn" | "principal">[];
        })
      | null;
  },
  schedule: DebtSchedule | null,
  now: Date = new Date(),
) {
  const { valuations: _valuations, ...debt } = serializeAssetWithDebt(
    asset,
    schedule,
  ) as ReturnType<typeof serializeAssetWithDebt> & { valuations?: unknown };
  const loan = asset.loan;
  return {
    ...debt,
    debtRemaining: loan ? loanBalanceAt({ ...loan, repayments: loan.repayments ?? [] }, now) : null,
    loanId: asset.loanId,
    loanLenderName: loan?.lenderName ?? null,
    ...serializeValuation(asset, now),
  };
}
