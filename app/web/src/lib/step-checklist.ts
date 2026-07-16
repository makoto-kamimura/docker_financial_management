// F-10: ダッシュボードのステップ進捗チェックリスト（仕様書 付録 A・§2 の 6 ステップに対応）

export type StepChecklistInput = {
  hasIncomeBudget: boolean;
  hasExpenseBudget: boolean;
  hasBankAccount: boolean;
  hasPersonalAsset: boolean;
  hasLoan: boolean;
  hasSwitchedMode: boolean;
};

export type StepChecklistItem = { step: number; label: string; done: boolean };

export function computeStepChecklist(input: StepChecklistInput): StepChecklistItem[] {
  return [
    { step: 1, label: "家計簿として記録する（収入予算あり）", done: input.hasIncomeBudget },
    { step: 2, label: "収入から予算を配分する（支払予算あり）", done: input.hasExpenseBudget },
    { step: 3, label: "お金の流れを可視化する（口座あり）", done: input.hasBankAccount },
    { step: 4, label: "総資産を把握する（実物資産あり）", done: input.hasPersonalAsset },
    { step: 5, label: "ローンを予算に織り込む（ローンあり）", done: input.hasLoan },
    { step: 6, label: "法人会計を学ぶ（モード切替経験）", done: input.hasSwitchedMode },
  ];
}
