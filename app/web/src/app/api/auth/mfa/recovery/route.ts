import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest, notFound } from "@/lib/api-error";
import { verifyTotpWithReplayGuard } from "@/lib/totp-replay-guard";

const RECOVERY_CODE_COUNT = 8;

function generateCode(): string {
  return randomBytes(5)
    .toString("hex")
    .toUpperCase()
    .replace(/(.{4})(.{4})(.{2})/, "$1-$2-$3");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/mfa/recovery — リカバリーコードの発行（MFA 有効時のみ）
// 既存コードは無効化される
export const POST = withApi({
  role: "viewer",
  handler: async ({ req, user: sessionUser, audit }) => {
    // ボディ省略も許容する（TOTP 検証で本人確認するため）
    const body = (await req.json().catch(() => ({}))) as { totp?: string };

    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user) throw notFound("user not found");
    if (!user.mfaEnabled) throw badRequest("MFA が有効ではありません");

    // TOTP コードで本人確認
    if (user.totpSecret) {
      const ok =
        body.totp &&
        (await verifyTotpWithReplayGuard(
          user.id,
          user.totpSecret,
          body.totp,
          user.totpLastUsedStep,
        ));
      if (!ok) {
        throw new ApiError(401, "TOTP コードが正しくありません");
      }
    }

    // 新規コードを生成
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateCode());
    const hashes = codes.map(hashCode);

    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { mfaRecoveryCodes: JSON.stringify(hashes) },
    });

    await audit("mfa_recovery_generate", `user:${sessionUser.id}`);

    return NextResponse.json({
      codes,
      message: "リカバリーコードを安全な場所に保管してください。再表示はできません。",
    });
  },
});
