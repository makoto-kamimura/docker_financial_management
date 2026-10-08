import { describe, expect, it } from "vitest";
import { hasTargetColumn, parseTarget, routeLedgerRows } from "./ledger-import";

const ctx = {
  bankAccounts: [{ id: 1, name: "住信SBI" }],
  cards: [{ id: 7, name: "三井住友カード" }],
};

describe("parseTarget / hasTargetColumn", () => {
  it("日本語と英語のどちらでも読める", () => {
    expect(parseTarget("実績")).toBe("actual");
    expect(parseTarget(" Bank ")).toBe("bank");
    expect(parseTarget("電子マネー")).toBe("card");
    expect(parseTarget("その他")).toBeNull();
    expect(hasTargetColumn(["target", "account"])).toBe(true);
    expect(hasTargetColumn(["date", "description", "amount"])).toBe(false);
  });
});

describe("routeLedgerRows", () => {
  it("銀行・カードに振り分ける", () => {
    const r = routeLedgerRows(
      [
        {
          target: "銀行",
          account: "住信SBI",
          date: "2026-10-06",
          description: "給与",
          amount: "300000",
        },
        {
          target: "カード",
          account: "三井住友カード",
          date: "2026-10-07",
          description: "スーパー",
          amount: "-3980",
        },
      ],
      ctx,
    );
    expect(r.errors).toEqual([]);
    expect(r.bank.get(1)?.map((t) => [t.description, t.amount])).toEqual([["給与", 300000]]);
    // カードも CSV のまま（支出は負）。明細の表も +入金 / −出金
    expect(r.card.get(7)?.map((t) => t.amount)).toEqual([-3980]);
  });

  it("登録先・口座・必要な列の誤りと、実績の行を行番号つきで返す", () => {
    const r = routeLedgerRows(
      [
        { target: "不明", amount: "1" },
        { target: "bank", account: "無い口座", date: "2026-10-01", description: "x", amount: "1" },
        { target: "実績", accountCode: "H1000", amount: "1", fiscalYear: "2026", month: "10" },
        {
          target: "card",
          account: "三井住友カード",
          date: "2026-10-01",
          description: "",
          amount: "1",
        },
      ],
      ctx,
    );
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
  });
});
