import { describe, expect, it } from "vitest";
import { retakeHint } from "./receipt-hints";

const missing = { date: null, total: null };

describe("retakeHint", () => {
  it("日付と合計を読めていれば、警告があっても案内しない", () => {
    expect(retakeHint(["blurry"], { date: "2026-10-13", total: 1280 })).toBeNull();
  });

  it("読めなかった項目があれば、先に直したほうが効く警告から案内する", () => {
    expect(retakeHint(["low_resolution", "blurry"], missing)).toContain("ぼやけています");
    expect(retakeHint(["low_resolution"], { date: "2026-10-13", total: null })).toContain(
      "近づいて",
    );
  });

  it("警告が無い・知らない警告だけなら案内しない", () => {
    expect(retakeHint([], missing)).toBeNull();
    expect(retakeHint(undefined, missing)).toBeNull();
    expect(retakeHint(["glare_v2"], missing)).toBeNull();
  });
});
