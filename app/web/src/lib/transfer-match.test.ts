import { describe, expect, it } from "vitest";
import {
  dayGap,
  findTransferMatches,
  validateTransferLink,
  type MatchableTxn,
} from "./transfer-match";

const txn = (
  id: number,
  accountId: number,
  date: string,
  amount: number,
  description = "振込",
): MatchableTxn => ({ id, accountId, date: new Date(date), description, amount });

describe("dayGap", () => {
  it("同じ日は 0、順序に依らず絶対値を返す", () => {
    expect(dayGap(new Date("2026-08-03"), new Date("2026-08-03"))).toBe(0);
    expect(dayGap(new Date("2026-07-31"), new Date("2026-08-03"))).toBe(3);
    expect(dayGap(new Date("2026-08-03"), new Date("2026-07-31"))).toBe(3);
  });
});

describe("findTransferMatches", () => {
  it("同額・符号が逆・別口座・同日の組を候補にする", () => {
    const out = txn(1, 10, "2026-08-03", -50000);
    const income = txn(2, 11, "2026-08-03", 50000);
    const matches = findTransferMatches([out, income]);
    expect(matches).toHaveLength(1);
    expect(matches[0].outTxn.id).toBe(1);
    expect(matches[0].inTxn.id).toBe(2);
    expect(matches[0].amount).toBe(50000);
    expect(matches[0].dayGap).toBe(0);
  });

  it("着金が数日ずれても許容範囲なら候補にする", () => {
    const matches = findTransferMatches([
      txn(1, 10, "2026-07-31", -8000),
      txn(2, 11, "2026-08-03", 8000),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].dayGap).toBe(3);
  });

  it("許容日数を超えたずれは候補にしない", () => {
    const rows = [txn(1, 10, "2026-07-31", -8000), txn(2, 11, "2026-08-04", 8000)];
    expect(findTransferMatches(rows)).toHaveLength(0);
    // 許容値を広げれば拾える
    expect(findTransferMatches(rows, { maxDayGap: 7 })).toHaveLength(1);
  });

  it("同じ口座どうし・金額違い・同符号は候補にしない", () => {
    // 同一口座内の出入金（例: ATM 出金と入金）は振替ではない
    expect(
      findTransferMatches([txn(1, 10, "2026-08-03", -50000), txn(2, 10, "2026-08-03", 50000)]),
    ).toHaveLength(0);
    // 金額が一致しない
    expect(
      findTransferMatches([txn(1, 10, "2026-08-03", -50000), txn(2, 11, "2026-08-03", 49780)]),
    ).toHaveLength(0);
    // 出金どうし
    expect(
      findTransferMatches([txn(1, 10, "2026-08-03", -50000), txn(2, 11, "2026-08-03", -50000)]),
    ).toHaveLength(0);
  });

  it("1 つの明細を複数の組に使い回さず、日付の近い組を優先する", () => {
    const out = txn(1, 10, "2026-08-03", -20000);
    const near = txn(2, 11, "2026-08-03", 20000);
    const far = txn(3, 11, "2026-08-05", 20000);
    const matches = findTransferMatches([out, far, near]);
    expect(matches).toHaveLength(1);
    expect(matches[0].inTxn.id).toBe(near.id);
  });

  it("同額の振替が複数あればそれぞれ 1 組ずつ対にする", () => {
    const matches = findTransferMatches([
      txn(1, 10, "2026-08-03", -20000),
      txn(2, 11, "2026-08-03", 20000),
      txn(3, 10, "2026-06-01", -20000),
      txn(4, 11, "2026-06-01", 20000),
    ]);
    expect(matches).toHaveLength(2);
    // 出金日の新しい順
    expect(matches.map((m) => m.outTxn.id)).toEqual([1, 3]);
    expect(matches.map((m) => m.inTxn.id)).toEqual([2, 4]);
  });

  it("振替の合計は 0 になる（テナント全体の残高は動かない）", () => {
    const matches = findTransferMatches([
      txn(1, 10, "2026-08-03", -20000),
      txn(2, 11, "2026-08-03", 20000),
    ]);
    expect(matches[0].outTxn.amount + matches[0].inTxn.amount).toBe(0);
  });
});

describe("validateTransferLink", () => {
  const out = { id: 1, accountId: 10, amount: -50000, transferGroupId: null, postedRecordId: null };
  const income = {
    id: 2,
    accountId: 11,
    amount: 50000,
    transferGroupId: null,
    postedRecordId: null,
  };

  it("出金と入金の正しい組なら null", () => {
    expect(validateTransferLink(out, income)).toBeNull();
    // 引数の順序は問わない
    expect(validateTransferLink(income, out)).toBeNull();
  });

  it("同じ明細・同じ口座は弾く", () => {
    expect(validateTransferLink(out, out)).toContain("同じ明細");
    expect(validateTransferLink(out, { ...income, accountId: 10 })).toContain("同じ口座");
  });

  it("すでに紐付け済み・転記済みは弾く", () => {
    expect(validateTransferLink({ ...out, transferGroupId: "g-1" }, income)).toContain(
      "すでに振替",
    );
    expect(validateTransferLink(out, { ...income, postedRecordId: 5 })).toContain("転記済み");
  });

  it("符号・金額が噛み合わない組は弾く", () => {
    expect(validateTransferLink(out, { ...income, amount: -50000 })).toContain("出金");
    expect(validateTransferLink(out, { ...income, amount: 49780 })).toContain("金額が一致しません");
  });
});
