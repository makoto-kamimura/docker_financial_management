import { describe, expect, it } from "vitest";
import { findOffsetPairs, type OffsetEntry } from "./auto-offset";

let nextId = 1;
const bank = (accountId: number, ymd: string, flow: number): OffsetEntry => ({
  id: nextId++,
  kind: "BANK",
  accountId,
  cardType: null,
  ymd,
  flow,
});
const card = (accountId: number, cardType: string, ymd: string, flow: number): OffsetEntry => ({
  id: nextId++,
  kind: "CARD",
  accountId,
  cardType,
  ymd,
  flow,
});

describe("findOffsetPairs", () => {
  it("同じ日・同じ金額の銀行どうしの出金と入金が 1 組だけなら振替にする", () => {
    const out = bank(1, "2026-10-01", -50_000);
    const inn = bank(2, "2026-10-01", 50_000);
    expect(findOffsetPairs([out, inn])).toEqual([
      { outId: out.id, inId: inn.id, type: "transfer", chargeToCardId: null },
    ]);
  });

  it("銀行・カードから電子マネー・プリペイドへの入金はチャージにする", () => {
    const out = bank(1, "2026-10-02", -5_000);
    const emoney = card(9, "E_MONEY", "2026-10-02", 5_000);
    const cardOut = card(7, "CREDIT_CARD", "2026-10-03", -3_000);
    const prepaid = card(8, "PREPAID_CARD", "2026-10-03", 3_000);
    expect(findOffsetPairs([out, emoney, cardOut, prepaid])).toEqual([
      { outId: out.id, inId: emoney.id, type: "charge", chargeToCardId: 9 },
      { outId: cardOut.id, inId: prepaid.id, type: "charge", chargeToCardId: 8 },
    ]);
  });

  it("候補が 2 組以上あると、どれとどれが対か決められないので組にしない", () => {
    const out = bank(1, "2026-10-04", -10_000);
    const a = bank(2, "2026-10-04", 10_000);
    const b = bank(3, "2026-10-04", 10_000);
    expect(findOffsetPairs([out, a, b])).toEqual([]);
    const out2 = bank(1, "2026-10-05", -1_000);
    const out3 = bank(2, "2026-10-05", -1_000);
    const inn = bank(3, "2026-10-05", 1_000);
    expect(findOffsetPairs([out2, out3, inn])).toEqual([]);
  });

  it("日付・金額が違う、同じ口座、クレジットカードへの入金、銀行への入金（カードから）は組にしない", () => {
    expect(findOffsetPairs([bank(1, "2026-10-06", -100), bank(2, "2026-10-07", 100)])).toEqual([]);
    expect(findOffsetPairs([bank(1, "2026-10-06", -100), bank(2, "2026-10-06", 101)])).toEqual([]);
    expect(findOffsetPairs([bank(1, "2026-10-06", -100), bank(1, "2026-10-06", 100)])).toEqual([]);
    expect(
      findOffsetPairs([bank(1, "2026-10-06", -100), card(7, "CREDIT_CARD", "2026-10-06", 100)]),
    ).toEqual([]);
    expect(
      findOffsetPairs([card(9, "E_MONEY", "2026-10-06", -100), bank(1, "2026-10-06", 100)]),
    ).toEqual([]);
  });
});
