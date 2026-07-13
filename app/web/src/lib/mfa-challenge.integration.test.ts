/**
 * MFA チャレンジ（S-2: ログイン 2 段階化）の結合テスト（実 DB 使用）。
 *
 * 目的: mfaToken の TTL・使い捨て・5 回失敗でのロックという、
 *       ブルートフォース対策の核となる挙動を実 DB で検証する。
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { base32Decode, generateTotpSecret } from "@/lib/totp";
import { consumeMfaChallenge, issueMfaChallenge, MAX_MFA_ATTEMPTS } from "@/lib/mfa-challenge";

const SUFFIX = `mfa_${Date.now()}`;

// totp.ts の hotp() は非公開のため、テスト用に同一アルゴリズムで複製する（RFC 4226 HOTP）。
function hotp(secret: Buffer, counter: number): string {
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

function currentTotpCode(secretBase32: string): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(secret, counter);
}

let tenantId: number;
let userId: number;
let totpSecret: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `MfaTenant_${SUFFIX}` } });
  tenantId = tenant.id;
  totpSecret = generateTotpSecret();
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `mfa_${SUFFIX}@example.com`,
      name: "MFA User",
      passwordHash: "x",
      role: "admin",
      mfaEnabled: true,
      totpSecret,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.mfaChallenge.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("mfa-challenge", () => {
  it("正しい TOTP コードで検証成功し、チャレンジは使い捨てられる（再利用不可）", async () => {
    const token = await issueMfaChallenge(userId);
    const code = currentTotpCode(totpSecret);

    const result = await consumeMfaChallenge(token, { code });
    expect(result).toEqual({ status: "success", sessionUserId: userId });

    // 同じトークンを再度使うと invalid_token（使い捨て）
    const replay = await consumeMfaChallenge(token, { code });
    expect(replay.status).toBe("invalid_token");
  });

  it("誤ったコードは invalid_code、5 回目でアカウントロックしチャレンジは失効する", async () => {
    const token = await issueMfaChallenge(userId);

    for (let i = 1; i < MAX_MFA_ATTEMPTS; i++) {
      const r = await consumeMfaChallenge(token, { code: "000000" });
      expect(r.status).toBe("invalid_code");
    }

    const locked = await consumeMfaChallenge(token, { code: "000000" });
    expect(locked.status).toBe("locked");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lockedUntil).not.toBeNull();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // チャレンジは削除済みなのでロック中でも invalid_token になる
    const afterLock = await consumeMfaChallenge(token, { code: "000000" });
    expect(afterLock.status).toBe("invalid_token");

    // 後続テストに影響しないようロック解除
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: null, loginAttempts: 0 },
    });
  });

  it("期限切れトークン（TTL 経過）は invalid_token になる", async () => {
    const token = await issueMfaChallenge(userId);
    // TTL を過去に書き換えて期限切れをシミュレート
    await prisma.mfaChallenge.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const code = currentTotpCode(totpSecret);
    const result = await consumeMfaChallenge(token, { code });
    expect(result.status).toBe("invalid_token");
  });

  it("リカバリーコードでも検証でき、使用後は一覧から削除される（ワンタイム）", async () => {
    const rawCode = randomBytes(5).toString("hex").toUpperCase();
    const codeHash = createHash("sha256").update(rawCode).digest("hex");
    await prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: JSON.stringify([codeHash]) },
    });

    const token = await issueMfaChallenge(userId);
    const result = await consumeMfaChallenge(token, { recoveryCode: rawCode });
    expect(result).toEqual({ status: "success", sessionUserId: userId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const remaining: string[] = JSON.parse(user.mfaRecoveryCodes ?? "[]");
    expect(remaining).toHaveLength(0);
  });
});
