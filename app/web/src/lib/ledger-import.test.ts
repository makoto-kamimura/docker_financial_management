import { describe, expect, it } from "vitest";
import {
  hasDestinationColumn,
  normalizeRow,
  resolveDestination,
  routeLedgerRows,
} from "./ledger-import";

const ctx = {
  bankAccounts: [
    { id: 1, name: "住信SBI" },
    { id: 2, name: "共通の名前" },
  ],
  cards: [
    { id: 7, name: "三井住友カード" },
    { id: 8, name: "共通の名前" },
  ],
};

describe("列名と取り込み先", () => {
  it("日本語・英語のどちらの列名も読め、取り込み先の列の有無を見分ける", () => {
    expect(normalizeRow({ 取り込み先: "現金", 日付: "2026-10-01", 摘要: "x", 金額: "-1" })).toEqual(
      {
        account: "現金",
        date: "2026-10-01",
        description: "x",
        amount: "-1",
      },
    );
    expect(hasDestinationColumn(["取り込み先", "日付"])).toBe(true);
    expect(hasDestinationColumn(["account", "date"])).toBe(true);
    expect(hasDestinationColumn(["date", "description", "amount"])).toBe(false);
  });

  it("名前で現金・銀行・カードに決め、見つからない・重なる名前は理由を返す", () => {
    expect(resolveDestination("現金", ctx)).toEqual({ kind: "CASH" });
    expect(resolveDestination(" 住信SBI ", ctx)).toEqual({ kind: "BANK", accountId: 1 });
    expect(resolveDestination("三井住友カード", ctx)).toEqual({ kind: "CARD", accountId: 7 });
    expect(resolveDestination("共通の名前", ctx)).toMatchObject({
      error: expect.stringContaining("複数"),
    });
    expect(resolveDestination("無い口座", ctx)).toMatchObject({
      error: expect.stringContaining("見つかりません"),
    });
    expect(resolveDestination("", ctx)).toMatchObject({ error: expect.stringContaining("空欄") });
  });
});

describe("routeLedgerRows", () => {
  it("取り込み先の列で現金・銀行・カードに振り分ける（金額は CSV のまま）", () => {
    const r = routeLedgerRows(
      [
        { 取り込み先: "住信SBI", 日付: "2026-10-06", 摘要: "給与", 金額: "300000", 残高: "500000" },
        { 取り込み先: "三井住友カード", 日付: "2026-10-07", 摘要: "スーパー", 金額: "-3980" },
        { 取り込み先: "現金", 日付: "2026-10-08", 摘要: "八百屋", 金額: "-500" },
        { 取り込み先: "住信SBI", 日付: "2026-10-09", 摘要: "家賃", 金額: "-80000" },
      ],
      ctx,
    );
    expect(r.errors).toEqual([]);
    const byKind = Object.fromEntries(
      r.groups.map((g) => [g.destination.kind, g.rows.map((t) => [t.description, t.amount])]),
    );
    expect(byKind).toEqual({
      BANK: [
        ["給与", 300000],
        ["家賃", -80000],
      ],
      CARD: [["スーパー", -3980]],
      CASH: [["八百屋", -500]],
    });
  });

  it("列の無い CSV は、指定した取り込み先にすべて入れる", () => {
    const r = routeLedgerRows([{ date: "2026-10-01", description: "振込", amount: "1000" }], ctx, {
      kind: "BANK",
      accountId: 1,
    });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].destination).toEqual({ kind: "BANK", accountId: 1 });
  });

  it("取り込み先・必要な列の誤りを行番号つきで返す", () => {
    const r = routeLedgerRows(
      [
        { account: "無い口座", date: "2026-10-01", description: "x", amount: "1" },
        { account: "共通の名前", date: "2026-10-01", description: "x", amount: "1" },
        { account: "住信SBI", date: "2026-10-01", description: "", amount: "1" },
        { account: "住信SBI", date: "2026-10-01", description: "ok", amount: "1" },
      ],
      ctx,
    );
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
  });
});
