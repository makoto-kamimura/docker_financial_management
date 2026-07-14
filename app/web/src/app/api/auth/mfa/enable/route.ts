import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest } from "@/lib/api-error";
import { verifyTotpWithReplayGuard } from "@/lib/totp-replay-guard";

const Schema = z.object({ code: z.string().min(6) });

// POST /api/auth/mfa/enable … 認証アプリのコードを検証し MFA を有効化する。
export const POST = withApi({
  role: "viewer",
  schema: Schema,
  handler: async ({ user: sessionUser, body, audit }) => {
    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user?.totpSecret) throw badRequest("run setup first");
    const ok = await verifyTotpWithReplayGuard(
      user.id,
      user.totpSecret,
      body.code,
      user.totpLastUsedStep,
    );
    if (!ok) throw new ApiError(401, "invalid code");

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await audit("mfa_enable", `user:${user.id}`);
    return NextResponse.json({ ok: true });
  },
});
