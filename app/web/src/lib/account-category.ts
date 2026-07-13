// 勘定科目カテゴリ（prisma enum `AccountCategory` と同値）。
// Zod の enum 検証・画面のカテゴリ列挙で共用する定数。
export const ACCOUNT_CATEGORIES = [
  "REVENUE",
  "COGS",
  "EXPENSE",
  "PROFIT",
  "ASSET",
  "LIABILITY",
  "OTHER",
] as const;

export type AccountCategoryValue = (typeof ACCOUNT_CATEGORIES)[number];
