// 実物資産カテゴリ（Zod 検証・画面の列挙で共用する定数）
export const PERSONAL_ASSET_CATEGORIES = [
  "LAND",
  "BUILDING",
  "VEHICLE",
  "GOLD",
  "CASH",
  "DEPOSIT",
  "SECURITIES",
  "OTHER",
] as const;

export type PersonalAssetCategoryValue = (typeof PERSONAL_ASSET_CATEGORIES)[number];

// 純資産（総資産サマリ）に評価額を計上するかは countAsAsset で明示する。
// false にするのは「借入はあるが資産価値を持たない項目」— 住宅ローンに含まれる登記費用・
// 手数料などを想定している。以前はカテゴリ（負債紐付きなら LAND / BUILDING のみ計上）で
// 代用していたが、カーローンを紐付けた車や借入で買った金まで除外され、純資産がその
// 評価額分だけ過小に出ていたため、ユーザーが指定するフラグへ移行した。
export function isCountedAsAsset(asset: { countAsAsset: boolean }): boolean {
  return asset.countAsAsset;
}
