import { describe, expect, it } from "vitest";
import { amountText, yen, yenShort, yenSigned } from "./format";

describe("金額の表示", () => {
  it("yen: 「1,234円」。四捨五入し、負の数は全角のマイナス", () => {
    expect(yen(1234)).toBe("1,234円");
    expect(yen(1234.5)).toBe("1,235円");
    expect(yen(-1234)).toBe("−1,234円");
    expect(yen(0)).toBe("0円");
  });

  it("yenSigned: 向きのある金額は符号を付ける（0 は付けない）", () => {
    expect(yenSigned(1234)).toBe("+1,234円");
    expect(yenSigned(-1234)).toBe("−1,234円");
    expect(yenSigned(0)).toBe("0円");
    expect(yenSigned(-0.4)).toBe("0円");
  });

  it("yenShort: 1 万円以上は万円（小数 1 桁）", () => {
    expect(yenShort(9999)).toBe("9,999円");
    expect(yenShort(12_345)).toBe("1.2万円");
    expect(yenShort(1_234_567)).toBe("123.5万円");
    expect(yenShort(-50_000)).toBe("−5万円");
  });

  it("amountText: 表の中の数字だけ", () => {
    expect(amountText(1234567)).toBe("1,234,567");
    expect(amountText(-3)).toBe("−3");
  });
});
