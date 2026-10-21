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

  describe("候補が複数あるときの手がかり（摘要に相手の名前が出ている）", () => {
    // 2026-03-15 の形: 住信SBIネット銀行からの JAL Pay へのチャージと、三井住友カードからの JAL Pay へのチャージ
    // （カード側はチャージ先だけ付いた対の無い出金）。JAL 側には同じ日・同じ金額の入金が 2 件ある
    const sbi = { labels: ["住信SBIネット銀行", "住信SBIネット銀行"] };
    const jal = { labels: ["JAL Global Wallet", "JAL"] };
    const smbc = { labels: ["三井住友カード", "三井住友カード", "クレジットカード"] };
    const day = "2026-03-15";

    it("銀行の出金は、摘要に銀行名が出ている入金と組む。カードのチャージは「クレジットカード」の入金と 1 組だけ組む", () => {
      const bankOut = {
        ...bank(10, day, -5_000),
        ...sbi,
        description: "振替　ＪＡＬ　Ｐａｙ （1000076392839）",
      };
      const cardOuts = [1, 2, 3, 4].map(() => ({
        ...card(9, "CREDIT_CARD", day, -5_000),
        ...smbc,
        description: "[信] ＪＡＬ　Ｐａｙ",
        chargeTo: 7,
      }));
      const fromCard = {
        ...card(7, "PREPAID_CARD", day, 5_000),
        ...jal,
        description: "クレジットカード",
      };
      const fromBank = {
        ...card(7, "PREPAID_CARD", day, 5_000),
        ...jal,
        description: "住信SBIネット銀行",
      };
      expect(findOffsetPairs([bankOut, ...cardOuts, fromCard, fromBank])).toEqual([
        { outId: bankOut.id, inId: fromBank.id, type: "charge", chargeToCardId: 7 },
        { outId: cardOuts[0].id, inId: fromCard.id, type: "charge", chargeToCardId: 7 },
      ]);
    });

    it("区別の付かない入金だけなら id の小さい方と組み、区別が付いて手がかりも無ければ組にしない", () => {
      const out = { ...bank(10, day, -3_000), ...sbi, description: "振込" };
      const a = { ...card(7, "PREPAID_CARD", day, 3_000), ...jal, description: "チャージ" };
      const b = { ...card(7, "PREPAID_CARD", day, 3_000), ...jal, description: "チャージ" };
      // 同じカード・同じ日・同じ金額の入金は、どれと組んでも同じなので id の小さい方と組む
      expect(findOffsetPairs([out, a, b])).toEqual([
        { outId: out.id, inId: a.id, type: "charge", chargeToCardId: 7 },
      ]);
      const c = { ...card(8, "E_MONEY", day, 3_000), labels: ["PayPay"], description: "チャージ" };
      const out2 = { ...bank(10, day, -3_000), ...sbi, description: "振込" };
      const d = { ...card(7, "PREPAID_CARD", day, 3_000), ...jal, description: "チャージ" };
      // 別々のカードの入金は区別が付くので、手がかりが無ければ決めない
      expect(findOffsetPairs([out2, c, d])).toEqual([]);
    });

    it("対の無いチャージは、チャージ先のカードの入金とだけ組む", () => {
      const out = { ...card(9, "CREDIT_CARD", day, -2_000), ...smbc, chargeTo: 7 };
      const other = { ...card(8, "E_MONEY", day, 2_000), labels: ["PayPay"] };
      expect(findOffsetPairs([out, other])).toEqual([]);
      const target = { ...card(7, "PREPAID_CARD", day, 2_000), ...jal };
      expect(findOffsetPairs([out, other, target])).toEqual([
        { outId: out.id, inId: target.id, type: "charge", chargeToCardId: 7 },
      ]);
    });
  });
});
