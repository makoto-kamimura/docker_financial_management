import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  verifyPassword,
  hashPassword,
  isLegacyPasswordHash,
  DUMMY_PASSWORD_HASH,
} from "@/lib/auth";
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
// S-5: ユーザー不在・パスワード誤りを区別させない統一メッセージ（列挙対策）。
// 残り試行回数はレスポンスに含めず、監査ログ（login_failed の target）にのみ記録する。
const INVALID_CREDENTIALS_MESSAGE = "メールアドレスまたはパスワードが正しくありません";

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
    // ユーザー不在でもダミーハッシュに対し verifyPassword を実行し、
    // 実在ユーザーと同等の処理時間を発生させることでタイミング差による列挙を防ぐ
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  // アカウントロック確認
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainSec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: `アカウントがロックされています。${remainSec}秒後に再試行してください。` },
      { status: 429 },
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const attempts = user.loginAttempts + 1;
    const lockData =
      attempts >= MAX_ATTEMPTS
        ? { loginAttempts: attempts, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
        : { loginAttempts: attempts };
    await prisma.user.update({ where: { id: user.id }, data: lockData });
    await writeAudit(user.id, "login_failed", `user:${user.id} attempts:${attempts}`);
    return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  // S-6: パスワード認証成功。旧形式ハッシュ（salt:hash）なら透過的に新形式へ再ハッシュする
  if (isLegacyPasswordHash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  // MFA 無効ならここでセッション発行・失敗カウントリセット
  // （MFA 有効時はリセットを MFA 通過後まで遅らせる。TOTP 総当たり対策）
  if (!user.mfaEnabled || !user.totpSecret) {
    if (user.loginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }
    const sessionId = await createSession(user.id, req);
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
      const sessionId = await createSession(user.id, req);
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
