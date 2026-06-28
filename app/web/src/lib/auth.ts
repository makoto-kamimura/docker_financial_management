import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "fm_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 日

// パスワードを scrypt でハッシュ化する（外部依存なし）
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

// 平文パスワードとハッシュを比較する
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

// ログイン: セッションを作成し Cookie を設定する。セッション ID を返す（モバイル用）
export async function createSession(userId: number): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id, userId, expiresAt } });

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return id;
}

// 現在のリクエストのログインユーザーを取得する（未ログインなら null）
// Cookie（Web）または Authorization: Bearer <sessionId>（モバイル）の両方に対応
export async function getCurrentUser() {
  const reqHeaders = await headers();
  const auth = reqHeaders.get("authorization");
  const bearerSessionId = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  const store = await cookies();
  const sessionId = bearerSessionId ?? store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _passwordHash, ...user } = session.user;
  return user;
}

// ログアウト: セッションを削除し Cookie をクリアする
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    store.delete(SESSION_COOKIE);
  }
}
