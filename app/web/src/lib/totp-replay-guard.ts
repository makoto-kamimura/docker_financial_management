import { prisma } from "@/lib/prisma";
import { verifyTotpStep } from "@/lib/totp";

// S-7: TOTP コードを検証し、同一コード（同一ステップ）の使い回しを拒否する。
// 検証成功時は totpLastUsedStep を更新するため、直後に同じコードを再送しても
// 「ステップ番号が記録値以下」として拒否される（許容ウィンドウ内の別ステップは通る）。
export async function verifyTotpWithReplayGuard(
  userId: number,
  totpSecret: string,
  code: string,
  lastUsedStep: bigint | null,
): Promise<boolean> {
  const step = verifyTotpStep(totpSecret, code);
  if (step === null) return false;
  if (lastUsedStep !== null && BigInt(step) <= lastUsedStep) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { totpLastUsedStep: BigInt(step) },
  });
  return true;
}
