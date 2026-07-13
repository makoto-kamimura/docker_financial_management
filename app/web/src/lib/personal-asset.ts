// 実物資産カテゴリ（Zod 検証・画面の列挙で共用する定数）
export const PERSONAL_ASSET_CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

export type PersonalAssetCategoryValue = (typeof PERSONAL_ASSET_CATEGORIES)[number];

// 負債科目（住宅ローン等）に紐付く項目は土地・建物のみを資産評価額に計上する。
// ローンに含まれる諸費用等（その他）は負債の月割り対象にはなるが資産にはならない。
// 紐付けのない資産（車・金など）は従来どおり全て計上する。
export function isCountedAsAsset(asset: {
  category: PersonalAssetCategoryValue;
  linkedAccountId: number | null;
}): boolean {
  if (asset.linkedAccountId === null) return true;
  return asset.category === "LAND" || asset.category === "BUILDING";
}
