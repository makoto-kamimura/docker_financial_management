import { describe, expect, it } from "vitest";
import {
  dismissKey,
  findRecurringCandidates,
  normalizeDescription,
  type SuggestionTxn,
} from "@/lib/recurring-suggestions";

const today = new Date(2026, 9, 6);
const tx = (
  month: number,
  day: number,
  description: string,
  amount: number,
  accountId = 1,
): SuggestionTxn => ({
  accountId,
  date: new Date(2026, month - 1, day),
  description,
  amount,
});

describe("normalizeDescription", () => {
  it("数字・空白・記号を除き、全角半角をそろえる", () => {
    expect(normalizeDescription("ｶｰﾄﾞ 2026/09 ﾋｷｵﾄｼ")).toBe(
      normalizeDescription("カード 2026/10 ヒキオトシ"),
    );
  });
});

describe("findRecurringCandidates", () => {
  const salary = [6, 7, 8, 9].map((m) => tx(m, 25, `給与 ${m}月分`, 300_000 + m * 1000));
  const rent = [5, 6, 7, 8, 9].map((m) => tx(m, 27, "家賃", -80_000));

  it("毎月同じころ・同じくらいの入出金を候補にする（中央値の金額と日）", () => {
    const result = findRecurringCandidates([...salary, ...rent], [], new Set(), today);
    expect(result.map((c) => [c.direction, c.amount, c.day, c.months])).toEqual([
      ["in", 307_500, 25, 4],
      ["out", 80_000, 27, 5],
    ]);
  });

  it("金額や日がばらつくもの、出てくる月が少ないもの、止まったものは出さない", () => {
    const shopping = [6, 7, 8, 9].map((m, i) => tx(m, 10, "スーパー", -(3000 + i * 2000)));
    const scattered = [6, 7, 8, 9].map((m, i) => tx(m, 1 + i * 8, "ガス", -5000));
    const rare = [8, 9].map((m) => tx(m, 5, "保険", -10_000));
    const stopped = [3, 4, 5, 6].map((m) => tx(m, 15, "サブスク", -1000));
    expect(
      findRecurringCandidates(
        [...shopping, ...scattered, ...rare, ...stopped],
        [],
        new Set(),
        today,
      ),
    ).toEqual([]);
  });

  it("近い資金移動ルールがあるもの、非表示にしたものは出さない", () => {
    const rules = [{ fromId: null, toId: 1, amount: 305_000, day: 24 }];
    const [rentCandidate] = findRecurringCandidates(rent, [], new Set(), today);
    const result = findRecurringCandidates(
      [...salary, ...rent],
      rules,
      new Set([dismissKey(1, rentCandidate.signature)]),
      today,
    );
    expect(result).toEqual([]);
  });
});
