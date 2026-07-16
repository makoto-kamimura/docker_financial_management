import { z } from "zod";

// S-13: 環境変数の検証スキーマ。副作用（process.env の即時 parse）を持たないよう
// lib/config.ts と分離している（テストからスキーマ単体を検証できるようにするため）。
export const Env = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  CLEANUP_SERVICE_KEY: z.string().min(32).optional(), // 短い鍵を拒否
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  SESSION_IDLE_HOURS: z.coerce.number().default(24),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().default(7),
  UPLOAD_MAX_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  APP_ORIGIN: z.string().url().optional(),
});
