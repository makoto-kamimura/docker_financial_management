import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { ApiError } from "@/lib/api-error";
import { verifyTotpWithReplayGuard } from "@/lib/totp-replay-guard";

const Schema = z.object({ code: z.string().min(6) });

// POST /api/auth/mfa/disable … コード検証のうえ MFA を無効化する。
export const POST = withApi({
  role: "viewer",
  schema: Schema,
  handler: async ({ user: sessionUser, body, audit }) => {
    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user?.totpSecret) throw new ApiError(401, "invalid code");
    const ok = await verifyTotpWithReplayGuard(
      user.id,
      user.totpSecret,
      body.code,
      user.totpLastUsedStep,
    );
    if (!ok) throw new ApiError(401, "invalid code");

    // リカバリーコードも同時に破棄する。残したままにすると、後から別のシークレットで
    // MFA を再設定したときに古いコードが復活し、解除前に流出していた分で second factor を
    // 迂回できてしまう（再設定後は改めて発行する）
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, totpSecret: null, mfaRecoveryCodes: null },
    });
    await audit("mfa_disable", `user:${user.id}`);
    return NextResponse.json({ ok: true });
  },
});
