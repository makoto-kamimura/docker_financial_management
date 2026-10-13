// レシートの読み取りの流れ。回数を確かめて記録を入れ（同時の読み取りでも上限を超えないよう、
// テナントの行をロックしてから数える）、エンジンで読み、学習ルールで科目の候補を付ける。
import type { TenantDb } from "@/lib/server/tenant-db";
import { ApiError, tooManyRequests } from "@/lib/server/api-error";
import { getTenantPlan } from "@/lib/billing/plan";
import { billingEnabled } from "@/lib/billing/stripe";
import { loadRuleClassifier } from "@/lib/ledger/ledger-entries";
import { scanWithClaude, type ClaudeImageType } from "@/lib/ledger/receipt-scan/claude";
import { scanWithTesseract } from "@/lib/ledger/receipt-scan/tesseract";
import {
  DAILY_LIMIT,
  claudeAvailable,
  countScansToday,
  engineFor,
  receiptModel,
  scanSettings,
  startOfTokyoDay,
} from "@/lib/ledger/receipt-scan/quota";
import {
  ReceiptScanError,
  type ReceiptDraft,
  type ReceiptEngine,
  type ScanResult,
} from "@/lib/ledger/receipt-scan/types";

/** GET /api/actuals/receipt-scan の data（画面は reason を出すだけで、判定は読み取りのたびにやり直す） */
export type ReceiptScanStatus = {
  engine: ReceiptEngine;
  plan: "free" | "premium";
  limit: number;
  remaining: number;
  /** 使えないときの理由（使えるなら null） */
  reason: string | null;
  /** 有料プランにすると高精度の読み取りになるか（申し込みができ、Claude の設定もある） */
  upgradeAvailable: boolean;
};

export async function receiptScanStatus(
  db: TenantDb,
  now = new Date(),
): Promise<ReceiptScanStatus> {
  const settings = scanSettings();
  const { premium } = await getTenantPlan(db, now);
  const engine = engineFor(premium, settings);
  const limit = DAILY_LIMIT[engine];
  const remaining = Math.max(0, limit - (await countScansToday(db, now)));
  return {
    engine,
    plan: premium ? "premium" : "free",
    limit,
    remaining,
    reason: remaining === 0 ? limitMessage(limit) : null,
    upgradeAvailable: !premium && claudeAvailable(settings) && billingEnabled(),
  };
}

const limitMessage = (limit: number) =>
  `今日の読み取りの上限（${limit} 回）に達しました。明日またお試しください`;

export type ScanOutcome = {
  draft: ReceiptDraft;
  engine: ReceiptEngine;
  remaining: number;
  /** 学習ルールで店名から決めた科目（当たらなければ null） */
  suggestedAccount: { code: string; name: string; category: string } | null;
  requestId: number;
};

export async function scanReceipt(
  db: TenantDb,
  user: { id: number; tenantId: number },
  image: Buffer,
  mediaType: ClaudeImageType,
  now = new Date(),
): Promise<ScanOutcome> {
  const settings = scanSettings();
  const { premium } = await getTenantPlan(db, now);
  const engine = engineFor(premium, settings);
  const limit = DAILY_LIMIT[engine];
  const model = engine === "claude" ? receiptModel(settings) : null;

  const { request, used } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${user.tenantId} FOR UPDATE`;
    const used = await tx.receiptScanRequest.count({
      where: { createdAt: { gte: startOfTokyoDay(now) }, status: { not: "FAILED" } },
    });
    if (used >= limit) throw tooManyRequests(limitMessage(limit), "receipt_scan_limit");
    const request = await tx.receiptScanRequest.create({
      data: { tenantId: user.tenantId, userId: user.id, engine, model },
    });
    return { request, used };
  });

  let result: ScanResult;
  try {
    result =
      engine === "claude"
        ? await scanWithClaude(image, mediaType, {
            apiKey: settings.ANTHROPIC_API_KEY!,
            model: model!,
            baseURL: settings.ANTHROPIC_BASE_URL,
          })
        : await scanWithTesseract(image);
  } catch (e) {
    await db.receiptScanRequest.update({ where: { id: request.id }, data: { status: "FAILED" } });
    if (e instanceof ReceiptScanError)
      throw new ApiError(e.status, e.message, "receipt_scan_failed");
    throw e;
  }

  await db.receiptScanRequest.update({
    where: { id: request.id },
    data: {
      status: "SUCCEEDED",
      ...(result.usage && {
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }),
    },
  });

  return {
    draft: result.draft,
    engine,
    remaining: Math.max(0, limit - used - 1),
    suggestedAccount: await suggestAccount(db, result.draft.merchant),
    requestId: request.id,
  };
}

/** 店名を学習ルールにかけて、科目の候補を返す */
async function suggestAccount(db: TenantDb, merchant: string | null) {
  if (!merchant) return null;
  const hit = (await loadRuleClassifier(db))(merchant);
  if (!hit) return null;
  return db.account.findUnique({
    where: { id: hit.id },
    select: { code: true, name: true, category: true },
  });
}
