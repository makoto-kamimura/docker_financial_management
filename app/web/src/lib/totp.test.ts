import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
  verifyTotpStep,
} from "@/lib/totp";

// lib/totp.ts の hotp() は非公開のため、テスト側で RFC 4226 に基づき独立に現在コードを算出する
// （実装の内部呼び出しをそのまま検証するのではなく、仕様どおりの入出力になっているか確認するため）
function computeCurrentCode(secretBase32: string, step = 30): string {
  const counter = Math.floor(Date.now() / 1000 / step);
  const secret = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

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

describe("verifyTotpStep (S-7)", () => {
  const secret = generateTotpSecret();

  it("正しいコードでは現在のステップ番号（30 秒カウンタ）を返す", () => {
    const code = computeCurrentCode(secret);
    const expectedStep = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotpStep(secret, code)).toBe(expectedStep);
  });

  it("誤ったコードでは null を返す", () => {
    expect(verifyTotpStep(secret, "000000")).toBe(null);
  });

  it("同一コードを 2 回検証すると同一のステップ番号を返す（リプレイガードの前提）", () => {
    const code = computeCurrentCode(secret);
    const first = verifyTotpStep(secret, code);
    const second = verifyTotpStep(secret, code);
    expect(first).not.toBe(null);
    expect(first).toBe(second);
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
