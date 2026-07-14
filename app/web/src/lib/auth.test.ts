import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./auth";

describe("hashPassword / verifyPassword", () => {
  it("正しいパスワードで検証に成功する", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("誤ったパスワードでは検証に失敗する", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("不正な形式のハッシュ（区切り文字なし）では false を返す", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});

describe("DUMMY_PASSWORD_HASH (S-5)", () => {
  it("有効な salt:hash 形式であり、どんな入力でも検証は必ず失敗する", () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
