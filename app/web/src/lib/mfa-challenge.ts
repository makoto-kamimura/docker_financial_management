import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { verifyTotpWithReplayGuard } from "@/lib/totp-replay-guard";
import { writeAudit } from "@/lib/audit";

export const MFA_TOKEN_TTL_MS = 5 * 60 * 1000; // 5分
export const MAX_MFA_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// パスワード認証後に MFA チャレンジ（使い捨てトークン）を発行する。
// 生トークンは呼び出し側でクライアントへ返し、DB には SHA-256 ハッシュのみ保存する。
export async function issueMfaChallenge(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.mfaChallenge.create({
    data: { token: hashToken(token), userId, expiresAt: new Date(Date.now() + MFA_TOKEN_TTL_MS) },
  });
  return token;
}

type AuditMeta = { tenantId: number; ip?: string | null; userAgent?: string | null };

async function verifyCode(
  user: {
    id: number;
    totpSecret: string | null;
    totpLastUsedStep: bigint | null;
    mfaRecoveryCodes: string | null;
  },
  input: { code?: string; recoveryCode?: string },
  meta: AuditMeta,
): Promise<boolean> {
  if (input.recoveryCode) {
    const stored: string[] = user.mfaRecoveryCodes ? JSON.parse(user.mfaRecoveryCodes) : [];
    const hash = createHash("sha256").update(input.recoveryCode.trim().toUpperCase()).digest("hex");
    const idx = stored.indexOf(hash);
    if (idx === -1) return false;
    stored.splice(idx, 1);
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaRecoveryCodes: JSON.stringify(stored) },
    });
    await writeAudit(user.id, "mfa_recovery_used", `user:${user.id}`, meta);
    return true;
  }
  if (input.code && user.totpSecret) {
    return verifyTotpWithReplayGuard(user.id, user.totpSecret, input.code, user.totpLastUsedStep);
  }
  return false;
}

export type ConsumeResult =
  | { status: "success"; sessionUserId: number }
  | { status: "invalid_token" }
  | { status: "locked"; remainSec: number }
  | { status: "invalid_code" };

// MFA チャレンジを検証する。成功時はチャレンジを消費（削除）し loginAttempts をリセットする。
// 失敗時は attempts をインクリメントし、上限到達でチャレンジを失効させアカウントをロックする。
export async function consumeMfaChallenge(
  token: string,
  input: { code?: string; recoveryCode?: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ConsumeResult> {
  const hashed = hashToken(token);
  const challenge = await prisma.mfaChallenge.findUnique({
    where: { token: hashed },
    include: { user: true },
  });

  if (!challenge || challenge.expiresAt < new Date()) {
    if (challenge) await prisma.mfaChallenge.delete({ where: { token: hashed } }).catch(() => {});
    return { status: "invalid_token" };
  }

  const { user } = challenge;
  const auditMeta: AuditMeta = { tenantId: user.tenantId, ip: meta.ip, userAgent: meta.userAgent };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await prisma.mfaChallenge.delete({ where: { token: hashed } }).catch(() => {});
    return {
      status: "locked",
      remainSec: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
    };
  }

  const ok = await verifyCode(user, input, auditMeta);

  if (ok) {
    await prisma.mfaChallenge.delete({ where: { token: hashed } }).catch(() => {});
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });
    return { status: "success", sessionUserId: user.id };
  }

  const attempts = challenge.attempts + 1;
  if (attempts >= MAX_MFA_ATTEMPTS) {
    await prisma.mfaChallenge.delete({ where: { token: hashed } }).catch(() => {});
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: attempts, lockedUntil },
    });
    // S-12: 詳細設計書 §8 の記録必須イベント「account_locked」
    await writeAudit(
      user.id,
      "account_locked",
      `user:${user.id} reason:mfa attempts:${attempts}`,
      auditMeta,
    );
    return { status: "locked", remainSec: LOCK_MINUTES * 60 };
  }

  await prisma.mfaChallenge.update({ where: { token: hashed }, data: { attempts } });
  // S-12: 詳細設計書 §8 の記録必須イベント「mfa_verify_failed」
  await writeAudit(user.id, "mfa_verify_failed", `user:${user.id} attempts:${attempts}`, auditMeta);
  return { status: "invalid_code" };
}
