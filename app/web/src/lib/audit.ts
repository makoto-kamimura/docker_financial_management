import { prisma } from "@/lib/prisma";

interface AuditOptions {
  before?: unknown;
  after?:  unknown;
}

// 監査ログを記録する。before/after を渡すと変更差分も保存する。
export async function writeAudit(
  userId: number | null,
  action: string,
  target: string,
  options?: AuditOptions,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        target,
        before: options?.before != null ? JSON.stringify(options.before) : null,
        after:  options?.after  != null ? JSON.stringify(options.after)  : null,
      },
    });
  } catch {
    // 監査ログの失敗は本処理を止めない
  }
}
