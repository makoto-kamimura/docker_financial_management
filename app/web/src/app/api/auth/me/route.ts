import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// PATCH /api/auth/me … 自分の表示名を変える（ログインしていれば誰でも、自分の分だけ）。
// 表示名は画面の右上・ユーザー管理・監査ログに出る。ログインに使うメールアドレスは変えない。
export const PATCH = withApi({
  role: "viewer",
  schema: z.object({ name: z.string().trim().min(1).max(50) }),
  handler: async ({ user, body, audit }) => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true },
    });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: body.name },
      select: { id: true, name: true },
    });
    await audit("update_profile", `user:${user.id}`, {
      before: { name: before.name },
      after: { name: updated.name },
    });
    return NextResponse.json({ data: updated });
  },
});
