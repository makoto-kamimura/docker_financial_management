import { describe, expect, it } from "vitest";
import { isCountedAsAsset } from "./personal-asset";

describe("isCountedAsAsset", () => {
  it("ローン紐付きは土地・建物のみ資産計上する", () => {
    expect(isCountedAsAsset({ category: "LAND", linkedAccountId: 1 })).toBe(true);
    expect(isCountedAsAsset({ category: "BUILDING", linkedAccountId: 1 })).toBe(true);
    expect(isCountedAsAsset({ category: "OTHER", linkedAccountId: 1 })).toBe(false);
    expect(isCountedAsAsset({ category: "VEHICLE", linkedAccountId: 1 })).toBe(false);
    expect(isCountedAsAsset({ category: "GOLD", linkedAccountId: 1 })).toBe(false);
  });

  it("ローン紐付けなしの資産はすべて計上する", () => {
    expect(isCountedAsAsset({ category: "OTHER", linkedAccountId: null })).toBe(true);
    expect(isCountedAsAsset({ category: "VEHICLE", linkedAccountId: null })).toBe(true);
    expect(isCountedAsAsset({ category: "GOLD", linkedAccountId: null })).toBe(true);
    expect(isCountedAsAsset({ category: "LAND", linkedAccountId: null })).toBe(true);
  });
});
