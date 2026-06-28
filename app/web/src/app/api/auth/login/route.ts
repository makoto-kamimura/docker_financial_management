import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { writeAudit } from "@/lib/audit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().optional(), // MFA TOTP ワンタイムコード
  recoveryCode: z.string().optional(), // MFA リカバリーコード
});

const MAX_ATTEMPTS = 5; // 最大連続失敗回数
const LOCK_MINUTES = 15; // ロック時間 (分)

// POST /api/auth/login … メール + パスワード（+ 必要なら MFA コード or リカバリーコード）でログインする。
export async function POST(req: NextRequest) {
  const parsed = LoginSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, code, recoveryCode } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // ユーザー不在でも同一タイミング応答でメールアドレス列挙を防ぐ
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // アカウントロック確認
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainSec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: `アカウントがロックされています。${remainSec}秒後に再試行してください。` },
      { status: 429 },
    );
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const attempts = user.loginAttempts + 1;
    const lockData =
      attempts >= MAX_ATTEMPTS
        ? { loginAttempts: attempts, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
        : { loginAttempts: attempts };
    await prisma.user.update({ where: { id: user.id }, data: lockData });
    await writeAudit(user.id, "login_failed", `user:${user.id} attempts:${attempts}`);
    const remaining = MAX_ATTEMPTS - attempts;
    const msg =
      remaining <= 0
        ? `ログインに失敗しました。アカウントを ${LOCK_MINUTES} 分間ロックします。`
        : `ログインに失敗しました（残り ${remaining} 回でロック）。`;
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  // 認証成功: 失敗カウントをリセット
  if (user.loginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });
  }

  // MFA が有効ならワンタイムコードまたはリカバリーコードを要求
  if (user.mfaEnabled && user.totpSecret) {
    if (!code && !recoveryCode) {
      return NextResponse.json({ mfaRequired: true }, { status: 401 });
    }

    if (recoveryCode) {
      // リカバリーコード認証
      const stored: string[] = user.mfaRecoveryCodes ? JSON.parse(user.mfaRecoveryCodes) : [];
      const hash = createHash("sha256").update(recoveryCode.trim().toUpperCase()).digest("hex");
      const idx = stored.indexOf(hash);
      if (idx === -1) {
        return NextResponse.json({ error: "invalid recovery code" }, { status: 401 });
      }
      // 使用済みコードを削除（ワンタイム）
      stored.splice(idx, 1);
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodes: JSON.stringify(stored) },
      });
      await writeAudit(user.id, "mfa_recovery_used", `user:${user.id}`);
    } else if (code) {
      if (!verifyTotp(user.totpSecret, code)) {
        return NextResponse.json({ error: "invalid mfa code" }, { status: 401 });
      }
    }
  }

  const sessionId = await createSession(user.id);
  await writeAudit(user.id, "login", `user:${user.id}`);
  // sessionId はモバイルアプリ向けに返す（Web は Cookie を使用）
  return NextResponse.json({ data: { id: user.id, name: user.name, role: user.role, sessionId } });
}
