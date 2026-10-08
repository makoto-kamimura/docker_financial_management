import { describe, expect, it } from "vitest";
import { redactSecrets } from "./audit";

describe("redactSecrets (S-12)", () => {
  it("passwordHash / totpSecret / mfaRecoveryCodes をマスクする", () => {
    const before = {
      id: 1,
      email: "user@example.com",
      passwordHash: "scrypt$32768$8$1$deadbeef$cafebabe",
      totpSecret: "JBSWY3DPEHPK3PXP",
      mfaRecoveryCodes: '["hash1","hash2"]',
    };
    const redacted = redactSecrets(before) as Record<string, unknown>;
    expect(redacted.id).toBe(1);
    expect(redacted.email).toBe("user@example.com");
    expect(redacted.passwordHash).toBe("***");
    expect(redacted.totpSecret).toBe("***");
    expect(redacted.mfaRecoveryCodes).toBe("***");
  });

  it("ネストしたオブジェクト内のフィールドもマスクする", () => {
    const value = { user: { name: "test", passwordHash: "secret" } };
    const redacted = redactSecrets(value) as { user: Record<string, unknown> };
    expect(redacted.user.name).toBe("test");
    expect(redacted.user.passwordHash).toBe("***");
  });

  it("配列内の各要素もマスクする", () => {
    const value = [{ passwordHash: "a" }, { passwordHash: "b" }];
    const redacted = redactSecrets(value) as Record<string, unknown>[];
    expect(redacted[0].passwordHash).toBe("***");
    expect(redacted[1].passwordHash).toBe("***");
  });

  it("秘密情報を含まない値はそのまま返す", () => {
    expect(redactSecrets({ a: 1, b: "text" })).toEqual({ a: 1, b: "text" });
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(42)).toBe(42);
  });
});
