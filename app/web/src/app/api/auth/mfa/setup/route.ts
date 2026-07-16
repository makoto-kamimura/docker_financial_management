import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

// POST /api/auth/mfa/setup … TOTP シークレットを生成して返す（未有効化）。
// 認証アプリに otpauth URI を登録し、/enable でコード検証して有効化する。
export const POST = withApi({
  role: "viewer",
  handler: async ({ user }) => {
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

    const full = await prisma.user.findUnique({ where: { id: user.id } });
    return NextResponse.json({
      secret,
      otpauthUri: otpauthUri(secret, full?.email ?? `user-${user.id}`),
    });
  },
});
