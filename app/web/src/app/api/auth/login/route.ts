import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { writeAudit } from "@/lib/audit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().optional(), // MFA ワンタイムコード
});

// POST /api/auth/login … メール + パスワード（+ 必要なら MFA コード）でログインする。
export async function POST(req: NextRequest) {
  const parsed = LoginSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, code } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // MFA が有効ならワンタイムコードを要求
  if (user.mfaEnabled && user.totpSecret) {
    if (!code) {
      return NextResponse.json({ mfaRequired: true }, { status: 401 });
    }
    if (!verifyTotp(user.totpSecret, code)) {
      return NextResponse.json({ error: "invalid mfa code" }, { status: 401 });
    }
  }

  await createSession(user.id);
  await writeAudit(user.id, "login", `user:${user.id}`);
  return NextResponse.json({ data: { id: user.id, name: user.name, role: user.role } });
}
