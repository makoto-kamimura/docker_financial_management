import { prisma } from "@/lib/prisma";

// 監査ログを記録する。誰が・何を・どの対象に対して行ったかを残す。
export async function writeAudit(userId: number | null, action: string, target: string): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { userId, action, target } });
  } catch {
    // 監査ログの失敗は本処理を止めない
  }
}
