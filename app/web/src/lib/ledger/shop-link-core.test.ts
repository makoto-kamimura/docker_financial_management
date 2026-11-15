import { describe, it, expect } from "vitest";
import {
  allocateToTotal,
  dayGap,
  isAutoLinkable,
  planAutoLinks,
  rankCandidates,
  type LinkCharge,
  type LinkEntry,
  type LinkShop,
} from "./shop-link-core";

const amazon: LinkShop = {
  id: 1,
  type: "AMAZON",
  matchKeywords: [],
  excludeKeywords: [],
  paymentCardIds: [],
  paymentBankIds: [],
};
const charge = (id: number, ymd: string, amount: number, shopAccountId = 1): LinkCharge => ({
  id,
  shopAccountId,
  ymd,
  amount,
});
const entry = (
  id: number,
  ymd: string,
  flow: number,
  description = "AMAZON.CO.JP",
  sourceId = 9,
  kind: LinkEntry["kind"] = "CARD",
): LinkEntry => ({ id, kind, sourceId, ymd, flow, description });

describe("dayGap", () => {
  it("明細の日付 − 請求日（月をまたいでも日数）", () => {
    expect(dayGap("2026-11-02", "2026-10-30")).toBe(3);
    expect(dayGap("2026-10-28", "2026-10-30")).toBe(-2);
  });
});

describe("isAutoLinkable", () => {
  const c = charge(1, "2026-11-01", 3_000);
  it("金額が同じ・日付の範囲・摘要のキーワード・出金のときだけ", () => {
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000), amazon)).toBe(true);
    expect(isAutoLinkable(c, entry(1, "2026-10-29", -3_000), amazon)).toBe(true); // 3 日前
    expect(isAutoLinkable(c, entry(1, "2026-11-11", -3_000), amazon)).toBe(true); // 10 日後
    expect(isAutoLinkable(c, entry(1, "2026-10-28", -3_000), amazon)).toBe(false);
    expect(isAutoLinkable(c, entry(1, "2026-11-12", -3_000), amazon)).toBe(false);
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_001), amazon)).toBe(false);
    expect(isAutoLinkable(c, entry(1, "2026-11-01", 3_000), amazon)).toBe(false); // 入金
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000, "AMAZON PRIME"), amazon)).toBe(false);
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000, "セブンイレブン"), amazon)).toBe(false);
  });

  it("支払いに使うカードを選んでいれば、そのカードの明細だけ", () => {
    const only = { ...amazon, paymentCardIds: [9] };
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000, "AMAZON", 9), only)).toBe(true);
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000, "AMAZON", 8), only)).toBe(false);
    expect(isAutoLinkable(c, entry(1, "2026-11-01", -3_000, "AMAZON", 3, "BANK"), only)).toBe(
      false,
    );
  });
});

describe("planAutoLinks", () => {
  it("請求と明細が互いに 1 つに決まる組だけを返す", () => {
    const links = planAutoLinks(
      [charge(1, "2026-11-01", 3_000), charge(2, "2026-11-05", 1_200)],
      [
        entry(10, "2026-11-02", -3_000),
        entry(11, "2026-11-05", -1_200),
        entry(12, "2026-11-05", -500),
      ],
      [amazon],
    );
    expect(links).toEqual([
      { chargeId: 1, entryId: 10 },
      { chargeId: 2, entryId: 11 },
    ]);
  });

  it("同じ金額の明細が 2 つあり区別が付くとき（日付が違う）は決めない", () => {
    const links = planAutoLinks(
      [charge(1, "2026-11-01", 3_000)],
      [entry(10, "2026-11-01", -3_000), entry(11, "2026-11-03", -3_000)],
      [amazon],
    );
    expect(links).toEqual([]);
  });

  it("区別の付かない明細と、同じ候補の請求が同じ数なら、id の順に組む", () => {
    const links = planAutoLinks(
      [charge(2, "2026-11-01", 3_000), charge(1, "2026-11-01", 3_000)],
      [entry(11, "2026-11-01", -3_000), entry(10, "2026-11-01", -3_000)],
      [amazon],
    );
    expect(links).toEqual([
      { chargeId: 1, entryId: 10 },
      { chargeId: 2, entryId: 11 },
    ]);
  });

  it("1 つの明細を 2 つの請求が取り合うときは決めない", () => {
    const links = planAutoLinks(
      [charge(1, "2026-11-01", 3_000), charge(2, "2026-11-04", 3_000)],
      [entry(10, "2026-11-03", -3_000)],
      [amazon],
    );
    expect(links).toEqual([]);
  });
});

describe("rankCandidates", () => {
  it("金額の差 → キーワード → 日付の差の順に並べ、入金は出さない", () => {
    const ranked = rankCandidates(
      charge(1, "2026-11-01", 3_000),
      [
        entry(10, "2026-11-01", -2_500),
        entry(11, "2026-11-08", -3_000, "ﾗｸﾃﾝ"),
        entry(12, "2026-11-09", -3_000),
        entry(13, "2026-11-01", 3_000),
      ],
      amazon,
    );
    expect(ranked.map((r) => r.id)).toEqual([12, 11, 10]);
    expect(ranked[0]).toMatchObject({ dayGap: 8, amountGap: 0, keywordMatch: true });
    expect(ranked[2]).toMatchObject({ amountGap: -500 });
  });
});

describe("allocateToTotal", () => {
  it("合計が同じならそのまま", () => {
    expect(allocateToTotal([1_000, 2_000], 3_000)).toEqual([1_000, 2_000]);
  });

  it("違えば割合で割り振り、端数はいちばん大きい商品に寄せる", () => {
    // ポイントで 1,000 円引かれた: 3,000 → 2,000
    expect(allocateToTotal([1_000, 2_000], 2_000)).toEqual([667, 1_333]);
    const parts = allocateToTotal([333, 333, 334], 1_000 - 1);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999);
  });

  it("割引の行（負）も割合で割り振る", () => {
    const parts = allocateToTotal([3_000, -500], 2_000);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(2_000);
    expect(parts[1]).toBeLessThan(0);
  });

  it("商品の合計が 0 以下なら、いちばん大きい商品に入れる", () => {
    expect(allocateToTotal([0, 0], 500)).toEqual([500, 0]);
  });
});
