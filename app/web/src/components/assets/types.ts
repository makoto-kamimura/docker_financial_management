// 資産管理の実物資産の型（GET /api/personal-assets の応答）。

import { type BuildingStructure, type ValuationMethod } from "@/lib/shared/asset-valuation";
import { type PersonalAssetCategory } from "@/lib/shared/labels";

export type ValueTrend = "up" | "down" | "flat";
export type PersonalAssetPart = {
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
export type PersonalAsset = {
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
  /** ひも付いた借入（借入金管理で入力する）。無ければ null */
  loanId: number | null;
  loanLenderName: string | null;
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
