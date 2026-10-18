import { describe, expect, it } from "vitest";
import { checkStatementBalances } from "./balance-check";

describe("checkStatementBalances", () => {
  it("古い順の明細で、つながっていれば切れ目なし。最初の行の直前の残高を返す", () => {
    expect(
      checkStatementBalances([
        { date: "2026-10-01", amount: -3000, balance: 97000 },
        { date: "2026-10-02", amount: 50000, balance: 147000 },
      ]),
    ).toEqual({ gaps: [], opening: { date: "2026-10-01", balance: 100000 } });
  });

  it("新しい順の明細は、古い順に並べ直して見る", () => {
    expect(
      checkStatementBalances([
        { date: "2026-10-02", amount: 50000, balance: 147000 },
        { date: "2026-10-01", amount: -3000, balance: 97000 },
      ]),
    ).toEqual({ gaps: [], opening: { date: "2026-10-01", balance: 100000 } });
  });

  it("残高がつながらない行を返す（間の行が欠けている）", () => {
    const r = checkStatementBalances([
      { date: "2026-10-01", amount: -3000, balance: 97000 },
      { date: "2026-10-03", amount: -1000, balance: 90000 },
      { date: "2026-10-04", amount: -1000, balance: 89000 },
    ])!;
    expect(r.gaps).toEqual([{ index: 1, date: "2026-10-03", expected: 96000, actual: 90000 }]);
  });

  it("残高の無い行があれば照合しない", () => {
    expect(
      checkStatementBalances([
        { date: "2026-10-01", amount: -3000, balance: 97000 },
        { date: "2026-10-02", amount: -1000 },
      ]),
    ).toBeNull();
    expect(checkStatementBalances([])).toBeNull();
  });
});
