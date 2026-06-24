import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const RECOVERY_CODE_COUNT = 8;

function generateCode(): string {
  return randomBytes(5).toString("hex").toUpperCase().replace(/(.{4})(.{4})(.{2})/, "$1-$2-$3");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/mfa/recovery/generate — リカバリーコードの発行（MFA 有効時のみ）
// 既存コードは無効化される
export async function POST(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({})) as { totp?: string };

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (!user.mfaEnabled) {
    return NextResponse.json({ error: "MFA が有効ではありません" }, { status: 400 });
  }

  // TOTP コードで本人確認
  if (user.totpSecret) {
    const { verifyTotp } = await import("@/lib/totp");
    if (!body.totp || !verifyTotp(user.totpSecret, body.totp)) {
      return NextResponse.json({ error: "TOTP コードが正しくありません" }, { status: 401 });
    }
  }

  // 新規コードを生成
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const plain = generateCode();
    return plain;
  });

  const hashes = codes.map(hashCode);

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { mfaRecoveryCodes: JSON.stringify(hashes) },
  });

  await writeAudit(auth.user.id, "mfa_recovery_generate", `user:${auth.user.id}`);

  return NextResponse.json({
    codes,
    message: "リカバリーコードを安全な場所に保管してください。再表示はできません。",
  });
}
