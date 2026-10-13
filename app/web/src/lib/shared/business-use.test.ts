import { describe, expect, it } from "vitest";
import {
  businessPortion,
  businessUseText,
  defaultBusinessRatio,
  isValidBusinessRatio,
} from "./business-use";

describe("businessPortion", () => {
  it("金額 × 按分 ÷ 100 を、円未満を切り捨てる", () => {
    expect(businessPortion(3000, 50)).toBe(1500);
    expect(businessPortion(3000, 100)).toBe(3000);
    expect(businessPortion(1001, 50)).toBe(500);
    expect(businessPortion(3000, 33.33)).toBe(999);
  });

  it("負の額も 0 に向けて切り捨てる", () => {
    expect(businessPortion(-1001, 50)).toBe(-500);
  });

  it("浮動小数の誤差を出さない", () => {
    // 0.1 × 3 のような誤差で 1 円ずれないこと
    expect(businessPortion(30, 10)).toBe(3);
    expect(businessPortion(123456789, 70)).toBe(86419752);
  });
});

describe("isValidBusinessRatio", () => {
  it("0 より大きく 100 以下、小数 2 桁まで", () => {
    expect(isValidBusinessRatio(100)).toBe(true);
    expect(isValidBusinessRatio(33.33)).toBe(true);
    expect(isValidBusinessRatio(0)).toBe(false);
    expect(isValidBusinessRatio(100.01)).toBe(false);
    expect(isValidBusinessRatio(33.333)).toBe(false);
    expect(isValidBusinessRatio(Number.NaN)).toBe(false);
  });
});

describe("defaultBusinessRatio", () => {
  it("科目の割合があればそれ、無ければ 100%", () => {
    expect(defaultBusinessRatio(40)).toBe(40);
    expect(defaultBusinessRatio(null)).toBe(100);
    expect(defaultBusinessRatio(0)).toBe(100);
  });
});

describe("businessUseText", () => {
  it("事業利用のときだけ「事業 n%」", () => {
    expect(businessUseText(true, 50)).toBe("事業 50%");
    expect(businessUseText(true, 33.5)).toBe("事業 33.5%");
    expect(businessUseText(false, null)).toBe("");
  });
});
