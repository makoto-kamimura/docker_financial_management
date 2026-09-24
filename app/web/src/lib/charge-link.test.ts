import { describe, expect, it } from "vitest";
import {
  rankChargeCandidates,
  validateChargePair,
  type ChargeCandidateTxn,
  type LinkableChargeTxn,
} from "./charge-link";

const txn = (
  id: number,
  date: string,
  amount: number,
  description = "チャージ",
): ChargeCandidateTxn => ({
  id,
  date: new Date(date),
  amount,
  description,
  categoryAccountId: null,
});

const charge = { amount: 10000, date: new Date("2026-08-05") };

describe("rankChargeCandidates", () => {
  it("同額の入金（負の金額）を先頭に並べる", () => {
    const ranked = rankChargeCandidates(
      [txn(1, "2026-08-05", 10000, "利用"), txn(2, "2026-08-05", -10000, "チャージ")],
      charge,
    );
    expect(ranked.map((c) => c.txn.id)).toEqual([2, 1]);
    expect(ranked[0]).toMatchObject({ amountMatch: true, incoming: true, dayGap: 0 });
  });

  it("金額が一致しない入金より、金額が一致する行を優先する", () => {
    const ranked = rankChargeCandidates(
      [txn(1, "2026-08-05", -3000), txn(2, "2026-08-05", -10000)],
      charge,
    );
    expect(ranked[0].txn.id).toBe(2);
  });

  it("同じ優先度なら日付のずれが小さい順", () => {
    const ranked = rankChargeCandidates(
      [txn(1, "2026-08-02", -10000), txn(2, "2026-08-04", -10000)],
      charge,
    );
    expect(ranked.map((c) => c.txn.id)).toEqual([2, 1]);
    expect(ranked.map((c) => c.dayGap)).toEqual([1, 3]);
  });

  it("チャージ元の金額が負（銀行の出金）でも絶対値で突き合わせる", () => {
    const ranked = rankChargeCandidates([txn(1, "2026-08-05", -10000)], {
      amount: -10000,
      date: new Date("2026-08-05"),
    });
    expect(ranked[0].amountMatch).toBe(true);
  });

  it("許容日数を超えてずれた明細は候補にしない", () => {
    const rows = [txn(1, "2026-07-20", -10000)];
    expect(rankChargeCandidates(rows, charge)).toHaveLength(0);
    expect(rankChargeCandidates(rows, charge, { maxDayGap: 31 })).toHaveLength(1);
  });

  it("金額が一致しない利用明細も候補には残す（人が選べるようにする）", () => {
    const ranked = rankChargeCandidates([txn(1, "2026-08-06", 800, "コンビニ")], charge);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ amountMatch: false, incoming: false });
  });
});

describe("validateChargePair", () => {
  const base: LinkableChargeTxn = {
    id: 1,
    accountId: 7,
    postedRecordId: null,
    chargeGroupId: null,
    transferToAccountId: null,
  };

  it("チャージ先の未転記・未紐付けの明細は選べる", () => {
    expect(validateChargePair(base, 7)).toBeNull();
  });

  it("チャージ先以外のカードの明細は選べない", () => {
    expect(validateChargePair(base, 9)).toMatch(/チャージ先/);
  });

  it("転記済み・紐付け済み・チャージ指定済みの明細は選べない", () => {
    expect(validateChargePair({ ...base, postedRecordId: 100 }, 7)).toMatch(/転記/);
    expect(validateChargePair({ ...base, chargeGroupId: "uuid" }, 7)).toMatch(/既に/);
    expect(validateChargePair({ ...base, transferToAccountId: 8 }, 7)).toMatch(/チャージ/);
  });
});
