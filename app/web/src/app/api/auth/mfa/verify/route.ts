import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { consumeMfaChallenge } from "@/lib/mfa-challenge";

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
export async function POST(req: NextRequest) {
  const parsed = VerifySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { mfaToken, code, recoveryCode } = parsed.data;

  const result = await consumeMfaChallenge(mfaToken, { code, recoveryCode });

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
  const sessionId = await createSession(user.id);
  await writeAudit(user.id, "login", `user:${user.id}`);
  return NextResponse.json({ data: { id: user.id, name: user.name, role: user.role, sessionId } });
}
