import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { consumeMfaChallenge } from "@/lib/mfa-challenge";
import { clientIp } from "@/lib/rate-limit";

const VerifySchema = z
  .object({
    mfaToken: z.string().min(1),
    code: z.string().optional(),
    recoveryCode: z.string().optional(),
  })
  .refine((v) => !!v.code || !!v.recoveryCode, {
    message: "code または recoveryCode のいずれかが必要です",
  });

// POST /api/auth/mfa/verify … ログイン第2段階。mfaToken + TOTP コード or リカバリーコードでセッションを発行する。
// S-9: レート制限（5 回 / トークン生存中）は consumeMfaChallenge() の MfaChallenge.attempts +
// MAX_MFA_ATTEMPTS（S-2 で実装済み）により mfaToken 単位で既に実現されている。
// 詳細設計書 §4.3 の `rl:mfa:token:<sha256(mfaToken)>` はこの既存の仕組みと同一のもの。
export async function POST(req: NextRequest) {
  const parsed = VerifySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { mfaToken, code, recoveryCode } = parsed.data;
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  const result = await consumeMfaChallenge(mfaToken, { code, recoveryCode }, { ip, userAgent });

  if (result.status === "invalid_token") {
    return NextResponse.json({ error: "MFA トークンが無効か期限切れです" }, { status: 401 });
  }
  if (result.status === "locked") {
    return NextResponse.json(
      { error: `アカウントがロックされています。${result.remainSec}秒後に再試行してください。` },
      { status: 429 },
    );
  }
  if (result.status === "invalid_code") {
    return NextResponse.json({ error: "invalid mfa code" }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.sessionUserId } });
  const sessionId = await createSession(user.id, req);
  await writeAudit(user.id, "login", `user:${user.id}`, { tenantId: user.tenantId, ip, userAgent });
  return NextResponse.json({ data: { id: user.id, name: user.name, role: user.role, sessionId } });
}
