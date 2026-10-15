import { describe, expect, it } from "vitest";
import { normalizeDraft, selfMedicationOf } from "./types";

const base = {
  date: "2026-10-13",
  merchant: "店",
  total: 100,
  items: [],
  selfMedicationTotal: null,
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
    const d = normalizeDraft({
      ...base,
      merchant: "  ",
      items: [{ name: " ", amount: 1, selfMedication: false }],
    });
    expect(d.merchant).toBeNull();
    expect(d.items).toEqual([]);
  });
});

describe("selfMedicationOf", () => {
  const items = [
    { name: "かぜ薬", amount: 1_480, selfMedication: true },
    { name: "目薬", amount: 980, selfMedication: true },
    { name: "ティッシュ", amount: 298, selfMedication: false },
  ];

  it("対象の品目の合計と品目を返す", () => {
    expect(selfMedicationOf({ items, selfMedicationTotal: null })).toEqual({
      amount: 2_460,
      items: [
        { name: "かぜ薬", amount: 1_480 },
        { name: "目薬", amount: 980 },
      ],
    });
  });

  it("印字された対象額があればそれを使う。対象が無ければ null", () => {
    expect(selfMedicationOf({ items, selfMedicationTotal: 2_400 })?.amount).toBe(2_400);
    expect(selfMedicationOf({ items: [items[2]], selfMedicationTotal: null })).toBeNull();
  });
});
