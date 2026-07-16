import { isCountedAsAsset, type PersonalAssetCategoryValue } from "@/lib/personal-asset";

// F-8: 総資産サマリの集計。二重計上の除外規則（仕様書 §6.4）はすべてここで完結させる。
//
// 除外規則:
//   1. `linkedAccountMappings`（linked_accounts.accountId）に含まれる ASSET 科目残高は除外する
//      （銀行口座残高 bankBalances 側で同じ金額をすでに計上しているため）
//   2. `personalAssets[].linkedAccountId` に紐付いた LIABILITY 科目残高は除外する
//      （personalAssetDebts 側で同じ負債を月割り残高として計上しているため）
//   3. 実物資産自体は `isCountedAsAsset()`（lib/personal-asset.ts）でフィルタ済みのものだけ計上する

export type NetWorthPersonalAsset = {
  category: PersonalAssetCategoryValue;
  currentValue: number;
  linkedAccountId: number | null;
};
export type NetWorthBankBalance = { accountId: number; balance: number };
export type NetWorthAccountBalance = {
  accountId: number;
  category: "ASSET" | "LIABILITY";
  balance: number;
};
export type NetWorthLoan = { remainingAmount: number };
export type NetWorthLinkedAccountMapping = { accountId: number };
export type NetWorthPersonalAssetDebt = { remaining: number };

export type NetWorthBreakdownItem = { key: string; label: string; amount: number };

export type NetWorthResult = {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdownItem[];
};

export function summarizeNetWorth(input: {
  personalAssets: NetWorthPersonalAsset[];
  bankBalances: NetWorthBankBalance[];
  accountBalances: NetWorthAccountBalance[];
  loans: NetWorthLoan[];
  linkedAccountMappings: NetWorthLinkedAccountMapping[];
  personalAssetDebts: NetWorthPersonalAssetDebt[];
}): NetWorthResult {
  const bankLinkedAccountIds = new Set(input.linkedAccountMappings.map((m) => m.accountId));
  const assetLinkedLiabilityIds = new Set(
    input.personalAssets.map((a) => a.linkedAccountId).filter((id): id is number => id !== null),
  );

  const personalAssetsAmount = input.personalAssets
    .filter(isCountedAsAsset)
    .reduce((s, a) => s + a.currentValue, 0);

  const bankBalancesAmount = input.bankBalances.reduce((s, b) => s + b.balance, 0);

  const assetAccountsAmount = input.accountBalances
    .filter((a) => a.category === "ASSET" && !bankLinkedAccountIds.has(a.accountId))
    .reduce((s, a) => s + a.balance, 0);

  const liabilityAccountsAmount = input.accountBalances
    .filter((a) => a.category === "LIABILITY" && !assetLinkedLiabilityIds.has(a.accountId))
    .reduce((s, a) => s + a.balance, 0);

  const loansAmount = input.loans.reduce((s, l) => s + l.remainingAmount, 0);
  const personalAssetDebtsAmount = input.personalAssetDebts.reduce((s, d) => s + d.remaining, 0);

  const totalAssets = personalAssetsAmount + bankBalancesAmount + assetAccountsAmount;
  const totalLiabilities = liabilityAccountsAmount + loansAmount + personalAssetDebtsAmount;

  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    breakdown: [
      { key: "personalAssets", label: "実物資産", amount: personalAssetsAmount },
      { key: "bankBalances", label: "預貯金（口座残高）", amount: bankBalancesAmount },
      { key: "assetAccounts", label: "資産科目残高", amount: assetAccountsAmount },
      { key: "liabilityAccounts", label: "負債科目残高", amount: liabilityAccountsAmount },
      { key: "loans", label: "借入金残高", amount: loansAmount },
      {
        key: "personalAssetDebts",
        label: "実物資産紐付け負債残高",
        amount: personalAssetDebtsAmount,
      },
    ],
  };
}
