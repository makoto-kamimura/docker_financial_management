import type { TaxEstimate, TaxInputs, TaxLedger } from "@/lib/shared/tax-estimate";
import type { TaxRules } from "@/lib/shared/tax-rules";

/** GET /api/tax-return のレスポンス */
export type TaxReturnPayload = {
  year: number;
  ledger: TaxLedger;
  inputs: TaxInputs;
  rules: TaxRules;
  rulesInfo: { baseYear: number; fallback: boolean; changed: string[] };
  estimate: TaxEstimate;
};

/** 各タブに渡すもの。update は入力の一部を書き換える（保存は画面上部のボタン） */
export type TabProps = {
  year: number;
  ledger: TaxLedger;
  draft: TaxInputs;
  estimate: TaxEstimate;
  update: (patch: Partial<TaxInputs>) => void;
};
