import { describe, expect, it } from "vitest";
import { aggregate, bucketKey, type RecordWithPeriod } from "@/lib/aggregate";

const rec = (fiscalYear: number, month: number, amount: number): RecordWithPeriod => ({
  fiscalYear,
  month,
  quarter: Math.ceil(month / 3),
  amount,
});

describe("bucketKey", () => {
  it("月次は YYYY-MM 形式（ゼロ埋め）", () => {
    expect(bucketKey(rec(2025, 3, 0), "month")).toBe("2025-03");
  });
  it("四半期は YYYY-Qn 形式", () => {
    expect(bucketKey(rec(2025, 4, 0), "quarter")).toBe("2025-Q2");
  });
  it("年次は YYYY 形式", () => {
    expect(bucketKey(rec(2025, 12, 0), "year")).toBe("2025");
  });
});

describe("aggregate", () => {
  const records = [rec(2025, 1, 100), rec(2025, 2, 200), rec(2025, 3, 300), rec(2025, 4, 400)];

  it("月次は期間ごとに合計し昇順で返す", () => {
    const result = aggregate([...records, rec(2025, 1, 50)], "month");
    expect(result[0]).toEqual({ key: "2025-01", total: 150 });
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.key)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
  });

  it("四半期は3か月を合算する", () => {
    const result = aggregate(records, "quarter");
    expect(result).toEqual([
      { key: "2025-Q1", total: 600 }, // 100+200+300
      { key: "2025-Q2", total: 400 },
    ]);
  });

  it("年次は全月を合算する", () => {
    expect(aggregate(records, "year")).toEqual([{ key: "2025", total: 1000 }]);
  });

  it("空配列なら空を返す", () => {
    expect(aggregate([], "month")).toEqual([]);
  });
});
