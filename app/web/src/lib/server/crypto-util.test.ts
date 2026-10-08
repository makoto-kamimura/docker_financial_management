import { describe, expect, it } from "vitest";
import { safeEqual } from "./crypto-util";

describe("safeEqual (S-13)", () => {
  it("完全に一致する文字列は true", () => {
    expect(safeEqual("Bearer secret-key-1234567890", "Bearer secret-key-1234567890")).toBe(true);
  });

  it("内容が異なる同じ長さの文字列は false", () => {
    expect(safeEqual("Bearer aaaaaaaaaaaaaaaaaaaa", "Bearer bbbbbbbbbbbbbbbbbbbb")).toBe(false);
  });

  it("長さが異なる文字列は例外を投げずに false", () => {
    expect(safeEqual("short", "much-longer-string")).toBe(false);
    expect(safeEqual("much-longer-string", "short")).toBe(false);
  });

  it("空文字列同士は true", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});
