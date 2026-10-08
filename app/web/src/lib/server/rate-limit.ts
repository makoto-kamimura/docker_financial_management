import { createClient } from "redis";
import { NextResponse, type NextRequest } from "next/server";

// S-9: Redis の INCR + EXPIRE による固定窓レート制限。
// 認証系ルート（login/mfa）は Redis 不通時もレート制限を維持する必要があるため、
// プロセス内メモリのフォールバックカウンタを使う（options.useMemoryFallback）。
// それ以外（import/sync 等の認証済みルート）は Redis 不通時レート制限をスキップする
// （fail-open。可用性を優先する。既に認証済みの操作であるため悪用の影響は限定的）。

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = createClient({ url });
    client.on("error", (err: Error) => {
      console.warn("[rate-limit] redis connection error:", err.message);
    });
    client.connect().catch((err: Error) => {
      console.warn("[rate-limit] redis connect failed:", err.message);
    });
  }
  return client;
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

// メモリ内フォールバック（プロセス再起動でリセットされる。単一プロセス前提）
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

function checkMemoryFallback(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: { useMemoryFallback?: boolean } = {},
): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis.isReady) {
    if (options.useMemoryFallback) return checkMemoryFallback(key, limit, windowSeconds);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    if (count > limit) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    console.warn("[rate-limit] redis error, failing open:", (err as Error).message);
    if (options.useMemoryFallback) return checkMemoryFallback(key, limit, windowSeconds);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

// リクエストの発信元 IP を取得する（プロキシ経由を想定し x-forwarded-for の先頭値を使う）
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// 429 + Retry-After レスポンスの共通生成
export function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "リクエストが多すぎます。しばらくしてから再試行してください。" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
