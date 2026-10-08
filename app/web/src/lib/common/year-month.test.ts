import { describe, expect, it } from "vitest";
import { parseYearMonth } from "./year-month";

describe("parseYearMonth", () => {
  it("YYYY-MM 形式を月初日（UTC）に変換する", () => {
    expect(parseYearMonth("2035-03")?.toISOString()).toBe("2035-03-01T00:00:00.000Z");
    expect(parseYearMonth("2026-12")?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("日付文字列も月初日に正規化する", () => {
    expect(parseYearMonth("2030-06-15")?.toISOString()).toBe("2030-06-01T00:00:00.000Z");
  });

  it("不正な入力は undefined を返す", () => {
    expect(parseYearMonth("2035-13")).toBeUndefined();
    expect(parseYearMonth("abc")).toBeUndefined();
    expect(parseYearMonth("")).toBeUndefined();
  });
});
