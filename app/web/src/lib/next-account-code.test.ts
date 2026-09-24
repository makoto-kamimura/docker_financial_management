import { describe, expect, it } from "vitest";
import { nextAccountCode } from "@/lib/next-account-code";

describe("nextAccountCode", () => {
  it("同じ区分で最も多い接頭辞の続き番号を返す", () => {
    const codes = ["H-3001", "H-3002", "H-3010"];
    expect(nextAccountCode(codes, "EXPENSE")).toBe("H-3011");
  });

  it("桁数（ゼロ埋め）を保つ", () => {
    expect(nextAccountCode(["A007", "A008"], "OTHER")).toBe("A009");
  });

  it("少数派の接頭辞は無視して多数派に合わせる", () => {
    const codes = ["H-1001", "H-1002", "H-1003", "H1100"];
    expect(nextAccountCode(codes, "REVENUE")).toBe("H-1004");
  });

  it("既存コードが無い区分は既定の接頭辞から採番する", () => {
    expect(nextAccountCode([], "EXPENSE")).toBe("H-3001");
    expect(nextAccountCode([], "ASSET")).toBe("H-5001");
  });

  it("他区分で使用済みのコードは飛ばす", () => {
    const sameCategory = ["H-3001"];
    const all = ["H-3001", "H-3002", "H-3003"];
    expect(nextAccountCode(sameCategory, "EXPENSE", all)).toBe("H-3004");
  });

  it("数字で終わらないコードしか無い場合は既定の接頭辞を使う", () => {
    expect(nextAccountCode(["MISC"], "COGS")).toBe("H-2001");
  });
});
