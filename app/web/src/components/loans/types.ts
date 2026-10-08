// 借入金管理の部品で使う、参照用の型（GET /api/accounts・/api/personal-assets・/api/bank-accounts）
import type { PersonalAssetCategory } from "@/lib/labels";
import type { LoanRateChange } from "@/lib/loan-schedule";

export type AccountRef = { id: number; code: string; name: string; category: string };
export type AssetRef = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  loanId: number | null;
};
export type BankAccountRef = { id: number; name: string };
/** 改定後の返済額が未入力の金利変更 */
export type PendingChange = Pick<
  LoanRateChange,
  "id" | "previousMonthlyPayment" | "calculatedMonthlyPayment"
>;

/** ローンの種別から、その場で作る資産の種別の既定を決める（住宅→建物、カー→車） */
export const assetCategoryForLoanType = (loanType: string): PersonalAssetCategory =>
  loanType === "housing" ? "BUILDING" : loanType === "car" ? "VEHICLE" : "OTHER";
