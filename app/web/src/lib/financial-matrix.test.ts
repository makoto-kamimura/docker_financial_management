import { describe, expect, it } from "vitest";
import { buildFinancialMatrix, editableRecord, type MatrixRecord } from "@/lib/financial-matrix";

const account = (code: string, category = "EXPENSE") => ({
  id: Number(code.replace(/\D/g, "")) || 1,
  code,
  name: code,
  category,
});

const rec = (id: number, code: string, month: number, amount: number): MatrixRecord => ({
  id,
  amount,
  account: account(code),
  period: { fiscalYear: 2026, month },
});

describe("buildFinancialMatrix", () => {
  it("科目ごとに 1 行、月ごとにセルへまとめる", () => {
    const rows = buildFinancialMatrix([
      rec(1, "H3000", 1, 1000),
      rec(2, "H3000", 2, 2000),
      rec(3, "H1000", 1, 5000),
    ]);
    expect(rows.map((r) => r.account.code)).toEqual(["H1000", "H3000"]);
    const expense = rows.find((r) => r.account.code === "H3000")!;
    expect(expense.byMonth.get(1)!.total).toBe(1000);
    expect(expense.byMonth.get(2)!.total).toBe(2000);
    expect(expense.annual).toBe(3000);
  });

  it("同じ科目・同じ月の複数実績は合計し、元の行も保持する", () => {
    const rows = buildFinancialMatrix([rec(1, "H3000", 5, 1200), rec(2, "H3000", 5, 800)]);
    const cell = rows[0].byMonth.get(5)!;
    expect(cell.total).toBe(2000);
    expect(cell.records.map((r) => r.id)).toEqual([1, 2]);
    expect(rows[0].annual).toBe(2000);
  });

  it("実績が無ければ空配列", () => {
    expect(buildFinancialMatrix([])).toEqual([]);
  });
});

describe("editableRecord", () => {
  it("実績が 1 行だけのセルはその行を返す", () => {
    const rows = buildFinancialMatrix([rec(7, "H3000", 3, 500)]);
    expect(editableRecord(rows[0].byMonth.get(3))?.id).toBe(7);
  });

  it("複数行のセル・空セルは編集不可（null）", () => {
    const rows = buildFinancialMatrix([rec(1, "H3000", 3, 500), rec(2, "H3000", 3, 300)]);
    expect(editableRecord(rows[0].byMonth.get(3))).toBeNull();
    expect(editableRecord(rows[0].byMonth.get(4))).toBeNull();
    expect(editableRecord(undefined)).toBeNull();
  });
});
