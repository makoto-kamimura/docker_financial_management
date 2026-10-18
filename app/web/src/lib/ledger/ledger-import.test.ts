import { describe, expect, it } from "vitest";
import { normalizeRow, parseLedgerRows } from "./ledger-import";

describe("normalizeRow", () => {
  it("日本語・英語のどちらの列名も読める（知らない列はそのまま残す）", () => {
    expect(
      normalizeRow({ 日付: "2026-10-01", 摘要: "x", 金額: "-1", 残高: "9", メモ: "m" }),
    ).toEqual({ date: "2026-10-01", description: "x", amount: "-1", balance: "9", メモ: "m" });
    expect(normalizeRow({ Date: "2026-10-01", " amount ": "-1" })).toEqual({
      date: "2026-10-01",
      amount: "-1",
    });
  });
});

describe("parseLedgerRows", () => {
  it("行を明細にし、内容から決まる externalId を付ける（金額は CSV のまま）", () => {
    const r = parseLedgerRows(
      [
        { 日付: "2026-10-06", 摘要: "給与", 金額: "300000", 残高: "500000" },
        { 日付: "2026-10-09", 摘要: "家賃", 金額: "-80000" },
      ],
      42,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        date: "2026-10-06",
        description: "給与",
        amount: 300000,
        balance: 500000,
        externalId: "csv-42-2026-10-06-300000-給与",
      },
      {
        date: "2026-10-09",
        description: "家賃",
        amount: -80000,
        balance: undefined,
        externalId: "csv-42-2026-10-09--80000-家賃",
      },
    ]);
  });

  it("同じ日・同じ摘要・同じ金額の行は、番号を付けて別の明細として残す", () => {
    const row = { 日付: "2026-10-01", 摘要: "コンビニ", 金額: "-150" };
    const r = parseLedgerRows([row, row], 42);
    expect(r.rows.map((t) => t.externalId)).toEqual([
      "csv-42-2026-10-01--150-コンビニ",
      "csv-42-2026-10-01--150-コンビニ#2",
    ]);
  });

  it("日付・摘要・金額の誤りを行番号つきで返す", () => {
    const r = parseLedgerRows(
      [
        { date: "2026-10-01", description: "ok", amount: "1" },
        { date: "2026-10-01", description: "", amount: "1" },
        { date: "", description: "x", amount: "1" },
        { date: "2026-10-01", description: "x", amount: "notanumber" },
      ],
      1,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });
});
