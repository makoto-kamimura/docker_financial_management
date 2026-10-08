import { describe, expect, it } from "vitest";
import { isCountedAsAsset, type PersonalAssetCategoryValue } from "./personal-asset";

// 実物資産の一部（判定に関係する項目 + 旧実装が見ていた項目）を組み立てる
const asset = (
  countAsAsset: boolean,
  category: PersonalAssetCategoryValue = "OTHER",
  linkedAccountId: number | null = null,
) => ({ countAsAsset, category, linkedAccountId });

describe("isCountedAsAsset", () => {
  it("countAsAsset フラグをそのまま返す", () => {
    expect(isCountedAsAsset(asset(true))).toBe(true);
    expect(isCountedAsAsset(asset(false))).toBe(false);
  });

  it("カテゴリや負債紐付けの有無では判定しない", () => {
    // 旧実装は「負債紐付きなら LAND / BUILDING のみ計上」というカテゴリ判定だったため、
    // カーローンを紐付けた車が資産計上されず純資産が過小に出ていた。
    // 現在はカテゴリを見ないので、フラグが true なら計上される
    expect(isCountedAsAsset(asset(true, "VEHICLE", 1))).toBe(true);
    expect(isCountedAsAsset(asset(true, "GOLD", 1))).toBe(true);
    // 逆に土地でもフラグを落とせば計上外にできる
    expect(isCountedAsAsset(asset(false, "LAND", null))).toBe(false);
  });
});
