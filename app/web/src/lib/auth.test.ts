import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, isLegacyPasswordHash, verifyPassword } from "./auth";

describe("hashPassword / verifyPassword (S-6: 新形式 scrypt$N$r$p$salt$hash)", () => {
  it("正しいパスワードで検証に成功する", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("誤ったパスワードでは検証に失敗する", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("新形式ハッシュは scrypt$N$r$p$salt$hash の形式で保存される", async () => {
    const hash = await hashPassword("some-password");
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it("不正な形式のハッシュ（区切り文字なし）では false を返す", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });

  it("フィールド数が不正な新形式ハッシュでは false を返す", async () => {
    expect(await verifyPassword("anything", "scrypt$1$2$salt$hash")).toBe(false);
  });
});

describe("旧形式（salt:hash）との後方互換", () => {
  it("旧形式で保存されたハッシュも検証できる", async () => {
    // lib/auth.ts の旧実装が生成していた形式（N=16384 r=8 p=1 固定）を再現
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync("legacy-password", salt, 64).toString("hex");
    const legacyHash = `${salt}:${derived}`;

    expect(isLegacyPasswordHash(legacyHash)).toBe(true);
    expect(await verifyPassword("legacy-password", legacyHash)).toBe(true);
    expect(await verifyPassword("wrong-password", legacyHash)).toBe(false);
  });
});

describe("isLegacyPasswordHash", () => {
  it("新形式ハッシュは false と判定する", async () => {
    const hash = await hashPassword("x");
    expect(isLegacyPasswordHash(hash)).toBe(false);
  });

  it("salt:hash 形式は true と判定する", () => {
    expect(isLegacyPasswordHash("deadbeef:cafebabe")).toBe(true);
  });
});

describe("DUMMY_PASSWORD_HASH (S-5)", () => {
  it("有効な新形式であり、どんな入力でも検証は必ず失敗する", async () => {
    expect(isLegacyPasswordHash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
