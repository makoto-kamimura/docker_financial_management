import { createClient } from "redis";

let client: ReturnType<typeof createClient> | null = null;

function getRedisClient() {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = createClient({ url });
    client.on("error", (err: Error) => {
      console.warn("[redis] connection error — cache disabled:", err.message);
    });
    client.connect().catch((err: Error) => {
      console.warn("[redis] connect failed:", err.message);
    });
  }
  return client;
}

// 1時間 TTL のシンプルキャッシュ
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const redis = getRedisClient();
  try {
    if (redis.isReady) {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    }
  } catch {
    // cache miss — fall through
  }

  const value = await fn();

  try {
    if (redis.isReady) {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
    }
  } catch {
    // ignore cache write errors
  }

  return value;
}

export async function invalidateCache(pattern: string): Promise<void> {
  const redis = getRedisClient();
  try {
    if (!redis.isReady) return;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(keys);
  } catch {
    // ignore
  }
}
