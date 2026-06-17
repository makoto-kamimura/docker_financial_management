import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from "@/lib/totp";

describe("base32", () => {
  it("エンコード→デコードで元のバイト列に戻る", () => {
    const buf = Buffer.from("Hello TOTP!", "utf8");
    const decoded = base32Decode(base32Encode(buf));
    expect(decoded.equals(buf)).toBe(true);
  });
  it("RFC 4648 の既知ベクトル（'foobar'）", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("generateTotpSecret", () => {
  it("Base32 文字のみで構成される", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]+$/);
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();

  it("誤ったコードは拒否する", () => {
    expect(verifyTotp(secret, "000000")).toBe(false);
  });

  it("生成直後のシークレットで誤コードを通さない（境界）", () => {
    expect(verifyTotp(secret, "12")).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("otpauth スキーマと必須パラメータを含む", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "user@example.com", "FM");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=FM");
  });
});
