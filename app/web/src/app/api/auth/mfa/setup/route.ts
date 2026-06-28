import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

// POST /api/auth/mfa/setup … TOTP シークレットを生成して返す（未有効化）。
// 認証アプリに otpauth URI を登録し、/enable でコード検証して有効化する。
export async function POST() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: auth.user.id }, data: { totpSecret: secret } });

  const full = await prisma.user.findUnique({ where: { id: auth.user.id } });
  return NextResponse.json({
    secret,
    otpauthUri: otpauthUri(secret, full?.email ?? `user-${auth.user.id}`),
  });
}
