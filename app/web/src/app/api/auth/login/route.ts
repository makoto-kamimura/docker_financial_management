import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { consumeMfaChallenge, issueMfaChallenge } from "@/lib/mfa-challenge";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // 旧クライアント互換: password と同時に MFA コードを送る 1 段階フロー（1 リリースの間のみ許容）
  code: z.string().optional(),
  recoveryCode: z.string().optional(),
});

const MAX_ATTEMPTS = 5; // 最大連続失敗回数
const LOCK_MINUTES = 15; // ロック時間 (分)

// POST /api/auth/login … メール + パスワードでログインする。
// MFA 有効なユーザーは { mfaRequired: true, mfaToken } を返す（セッションは未発行）。
// 続けて POST /api/auth/mfa/verify に mfaToken + code|recoveryCode を送ることで完了する。
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

  // パスワード認証成功。MFA 無効ならここでセッション発行・失敗カウントリセット
  // （MFA 有効時はリセットを MFA 通過後まで遅らせる。TOTP 総当たり対策）
  if (!user.mfaEnabled || !user.totpSecret) {
    if (user.loginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }
    const sessionId = await createSession(user.id);
    await writeAudit(user.id, "login", `user:${user.id}`);
    return NextResponse.json({
      data: { id: user.id, name: user.name, role: user.role, sessionId },
    });
  }

  // 旧クライアント互換: password と同時に code/recoveryCode が送られた場合は
  // チャレンジ発行 → 即検証を内部で連続実行する（新エンドポイントと同じ試行制限・ロックを適用）
  if (code || recoveryCode) {
    const token = await issueMfaChallenge(user.id);
    const result = await consumeMfaChallenge(token, { code, recoveryCode });
    if (result.status === "success") {
      const sessionId = await createSession(user.id);
      await writeAudit(user.id, "login", `user:${user.id}`);
      return NextResponse.json({
        data: { id: user.id, name: user.name, role: user.role, sessionId },
      });
    }
    if (result.status === "locked") {
      return NextResponse.json(
        { error: `アカウントがロックされています。${result.remainSec}秒後に再試行してください。` },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "invalid mfa code" }, { status: 401 });
  }

  // 新フロー: MFA チャレンジトークンを発行してクライアントへ返す（セッションは未発行）
  const mfaToken = await issueMfaChallenge(user.id);
  return NextResponse.json({ mfaRequired: true, mfaToken }, { status: 401 });
}
