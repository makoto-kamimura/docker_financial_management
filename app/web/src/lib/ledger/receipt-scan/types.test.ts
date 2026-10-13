import { describe, expect, it } from "vitest";
import { normalizeDraft } from "./types";

const base = {
  date: "2026-10-13",
  merchant: "店",
  total: 100,
  items: [],
  paymentMethod: "cash" as const,
};

describe("normalizeDraft", () => {
  it("実在しない日付・形式の違う日付は null にする", () => {
    expect(normalizeDraft({ ...base, date: "2026-02-30" }).date).toBeNull();
    expect(normalizeDraft({ ...base, date: "2026/10/13" }).date).toBeNull();
    expect(normalizeDraft(base).date).toBe("2026-10-13");
  });

  it("合計は正の整数だけを残す", () => {
    expect(normalizeDraft({ ...base, total: 0 }).total).toBeNull();
    expect(normalizeDraft({ ...base, total: -5 }).total).toBeNull();
  });

  it("空の店名・空の品目名は落とす", () => {
    const d = normalizeDraft({ ...base, merchant: "  ", items: [{ name: " ", amount: 1 }] });
    expect(d.merchant).toBeNull();
    expect(d.items).toEqual([]);
  });
});
