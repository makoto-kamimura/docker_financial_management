import { describe, expect, it } from "vitest";
import { buildSettlementLookup } from "./card-settlement";

describe("buildSettlementLookup", () => {
  const lookup = buildSettlementLookup([
    { bankAccountId: 1, description: "カード代金 ＡＢＣ", chargeToCardId: 10 },
    { bankAccountId: 1, description: "カード代金 ＡＢＣ", chargeToCardId: 10 },
    // 同じ口座・同じ摘要が別々のカードに分かれていれば使わない
    { bankAccountId: 1, description: "まとめて", chargeToCardId: 10 },
    { bankAccountId: 1, description: "まとめて", chargeToCardId: 11 },
    { bankAccountId: 2, description: "まとめて", chargeToCardId: 11 },
    { bankAccountId: 1, description: "  ", chargeToCardId: 12 },
    { bankAccountId: 1, description: "未指定", chargeToCardId: null },
  ]);

  it("同じ口座・同じ摘要の出金に当たる（前後の空白・連続する空白・大文字小文字は区別しない）", () => {
    expect(lookup(1, "カード代金 ＡＢＣ", -100)).toBe(10);
    expect(lookup(1, " カード代金   ＡＢＣ ", -100)).toBe(10);
    expect(lookup(2, "まとめて", -100)).toBe(11);
  });

  it("別の口座・入金・別々のカードに分かれた摘要・空の摘要には当てない", () => {
    expect(lookup(2, "カード代金 ＡＢＣ", -100)).toBeNull();
    expect(lookup(1, "カード代金 ＡＢＣ", 100)).toBeNull();
    expect(lookup(1, "カード代金 ＡＢＣ", 0)).toBeNull();
    expect(lookup(1, "まとめて", -100)).toBeNull();
    expect(lookup(1, "", -100)).toBeNull();
    expect(lookup(1, null, -100)).toBeNull();
    expect(lookup(1, "未指定", -100)).toBeNull();
  });
});
