import { describe, expect, it } from "vitest";
import {
  fiscalMonthsError,
  isFiscalStartMonth,
  isValidFiscalMonths,
  startMonthFor,
} from "@/lib/accounting/fiscal-months";

describe("fiscal-months", () => {
  it("開始月は決算月の翌月（12 月決算は 1 月から）", () => {
    expect(startMonthFor(12)).toBe(1);
    expect(startMonthFor(3)).toBe(4);
    expect(startMonthFor(1)).toBe(2);
  });

  it("開始月と決算月が対応しているかを判定する", () => {
    expect(isValidFiscalMonths(4, 3)).toBe(true);
    expect(isValidFiscalMonths(1, 12)).toBe(true);
    expect(isValidFiscalMonths(5, 3)).toBe(false);
    expect(isValidFiscalMonths(12, 12)).toBe(false);
  });

  it("理由の文言に正しい開始月を入れる", () => {
    expect(fiscalMonthsError(3)).toBe("開始月は決算月（3月）の翌月の4月にしてください");
  });

  it("期の最初の月かを判定する", () => {
    expect(isFiscalStartMonth(4, 4)).toBe(true);
    expect(isFiscalStartMonth(5, 4)).toBe(false);
  });
});
