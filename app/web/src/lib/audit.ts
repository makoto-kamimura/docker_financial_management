import { prisma } from "@/lib/prisma";

export interface AuditOptions {
  before?: unknown;
  after?: unknown;
  tenantId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
}

// S-12: before/after にハッシュ・秘密情報が混入しないよう共通マスク関数を通す。
// 呼び出し側で個別にマスクする必要をなくし、うっかり平文ハッシュが監査ログへ
// 記録される経路（例: admin/users の更新監査）を構造的に遮断する。
const SECRET_FIELD_NAMES = new Set(["passwordHash", "totpSecret", "mfaRecoveryCodes"]);

export function redactSecrets(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_FIELD_NAMES.has(key) ? "***" : redactSecrets(v);
  }
  return out;
}

// 監査ログを記録する。before/after を渡すと変更差分も保存する（redactSecrets() 適用済み）。
// tenantId / ip / userAgent は withApi の ctx.audit() が自動付与する（§1.1）。
// pre-auth 経路（login / mfa/verify 等）は呼び出し側で明示的に渡す。
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
        tenantId: options?.tenantId ?? null,
        ip: options?.ip ?? null,
        userAgent: options?.userAgent?.slice(0, 255) ?? null,
        action,
        target,
        before: options?.before != null ? JSON.stringify(redactSecrets(options.before)) : null,
        after: options?.after != null ? JSON.stringify(redactSecrets(options.after)) : null,
      },
    });
  } catch (e) {
    // 監査ログの書き込み失敗は本処理を止めないが、観測できるようにログへ残す
    console.error("[audit] failed to write audit log:", action, target, e);
  }
}
