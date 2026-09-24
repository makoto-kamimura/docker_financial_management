import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// GET /api/auth/me … 現在のログインユーザーを返す。
//
// getCurrentUser() は passwordHash を除いた User 行をそのまま返すため、返す列は
// ここで明示的に選ぶ。totpSecret（TOTP のシークレット）や mfaRecoveryCodes は
// 画面に出す用途が無いうえ、漏れると多要素認証が第 2 要素として機能しなくなる。
// totpLastUsedStep は BigInt で JSON 化できず、そのまま返すと 500 になる。
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
    },
  });
}
