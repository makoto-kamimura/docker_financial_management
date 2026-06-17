import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { verifyTotp } from "@/lib/totp";
import { writeAudit } from "@/lib/audit";

const Schema = z.object({ code: z.string().min(6) });

// POST /api/auth/mfa/enable … 認証アプリのコードを検証し MFA を有効化する。
export async function POST(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user?.totpSecret) {
    return NextResponse.json({ error: "run setup first" }, { status: 400 });
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return NextResponse.json({ error: "invalid code" }, { status: 401 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await writeAudit(user.id, "mfa_enable", `user:${user.id}`);
  return NextResponse.json({ ok: true });
}
