import { describe, expect, it } from "vitest";
import { engineFor, receiptModel, startOfTokyoDay } from "./quota";

describe("startOfTokyoDay", () => {
  it("日本時間の 0 時を返す（UTC では前日の 15 時）", () => {
    expect(startOfTokyoDay(new Date("2026-10-13T03:00:00Z")).toISOString()).toBe(
      "2026-10-12T15:00:00.000Z",
    );
    // 日本時間の 0 時 30 分は、その日の始まり
    expect(startOfTokyoDay(new Date("2026-10-12T15:30:00Z")).toISOString()).toBe(
      "2026-10-12T15:00:00.000Z",
    );
    // 日本時間の 23 時 59 分は、まだ前の日
    expect(startOfTokyoDay(new Date("2026-10-12T14:59:00Z")).toISOString()).toBe(
      "2026-10-11T15:00:00.000Z",
    );
  });
});

describe("engineFor", () => {
  it("有料プランで API キーがあるときだけ Claude を使う", () => {
    expect(engineFor(true, { ANTHROPIC_API_KEY: "k" })).toBe("claude");
    expect(engineFor(true, {})).toBe("tesseract");
    expect(engineFor(false, { ANTHROPIC_API_KEY: "k" })).toBe("tesseract");
  });
});

describe("receiptModel", () => {
  it("既定は claude-opus-5-5。RECEIPT_OCR_MODEL で変えられる", () => {
    expect(receiptModel({})).toBe("claude-opus-5-5");
    expect(receiptModel({ RECEIPT_OCR_MODEL: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  });
});
