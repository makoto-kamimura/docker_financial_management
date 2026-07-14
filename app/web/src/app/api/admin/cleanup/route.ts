import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/crypto-util";

// POST /api/admin/cleanup — 期限切れセッションの削除（admin 限定）
// 定期実行: docker exec platform-web-1 curl -X POST http://localhost:3000/api/admin/cleanup
// または docker-compose で cron コンテナを追加して定期呼び出し
export async function POST(req: NextRequest) {
  // Bearer トークンによるサービスキー認証 or admin セッション認証
  // S-13: 文字列の === 比較（早期終了によるタイミング差）を safeEqual() に置換。
  // CLEANUP_SERVICE_KEY は lib/config.ts の Zod スキーマで 32 文字未満を起動時に拒否している
  const authHeader = req.headers.get("Authorization");
  const serviceKey = config.CLEANUP_SERVICE_KEY;

  if (serviceKey && authHeader && safeEqual(authHeader, `Bearer ${serviceKey}`)) {
    // サービスキー認証: cron からの呼び出し用
  } else {
    const auth = await requireRole("admin");
    if (auth.error) return auth.error;
  }

  const now = new Date();

  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const { count: mfaCount } = await prisma.mfaChallenge.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return NextResponse.json({
    deleted: count,
    deletedMfaChallenges: mfaCount,
    deletedAt: now.toISOString(),
  });
}

// GET /api/admin/cleanup — 期限切れセッション・MFA チャレンジ数の確認（admin 限定）
export async function GET() {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const now = new Date();
  const expiredCount = await prisma.session.count({
    where: { expiresAt: { lt: now } },
  });
  const totalCount = await prisma.session.count();
  const expiredMfaCount = await prisma.mfaChallenge.count({
    where: { expiresAt: { lt: now } },
  });
  const totalMfaCount = await prisma.mfaChallenge.count();

  return NextResponse.json({
    expired: expiredCount,
    total: totalCount,
    active: totalCount - expiredCount,
    mfaChallenges: {
      expired: expiredMfaCount,
      total: totalMfaCount,
      active: totalMfaCount - expiredMfaCount,
    },
  });
}
