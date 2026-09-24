import { describe, expect, it } from "vitest";
import { bankBalanceOf, buildBankBalanceMap, toNumber } from "./bank-balance";

describe("toNumber", () => {
  it("null / undefined / 数値化できない値は 0 として扱う", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
  });

  it("Decimal 相当の文字列も受け取れる", () => {
    expect(toNumber("554929.00")).toBe(554929);
    expect(toNumber(-362619)).toBe(-362619);
  });
});

describe("bankBalanceOf", () => {
  it("明細合計に差額を足す", () => {
    // 住信SBI: 明細合計 −362,619 + 期首相当の差額 554,929 = 192,310
    expect(bankBalanceOf(-362619, 554929)).toBe(192310);
  });

  it("差額が未設定なら明細合計のまま（移行前と同じ値）", () => {
    expect(bankBalanceOf(28370, 0)).toBe(28370);
    expect(bankBalanceOf(28370, null)).toBe(28370);
  });
});

describe("buildBankBalanceMap", () => {
  const accounts = [
    { id: 1, balanceAdjustment: "554929.00" },
    { id: 2, balanceAdjustment: 0 },
    { id: 3, balanceAdjustment: "10000" },
  ];

  it("口座ごとに 明細合計 + 差額 を返す", () => {
    const map = buildBankBalanceMap(accounts, [
      { accountId: 1, sum: -362619 },
      { accountId: 2, sum: 28370 },
    ]);
    expect(map.get(1)).toBe(192310);
    expect(map.get(2)).toBe(28370);
  });

  it("明細が 1 件も無い口座も差額だけの残高として含める", () => {
    const map = buildBankBalanceMap(accounts, []);
    expect(map.get(3)).toBe(10000);
    expect(map.get(2)).toBe(0);
    expect(map.size).toBe(3);
  });
});
