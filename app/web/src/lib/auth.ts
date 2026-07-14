import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCookieSecure, sessionCookieName, SESSION_TOKEN_PREFIX } from "@/lib/session-constants";

const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 日（絶対期限）
const IDLE_TTL_MS = 1000 * 60 * 60 * 24; // 24 時間（アイドルタイムアウト）
const LAST_SEEN_UPDATE_THRESHOLD_MS = 1000 * 60 * 60; // lastSeenAt 更新の間引き（1時間）

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 新形式（`fm2:` 接頭辞）はハッシュで DB 照合、旧形式（平文トークン）は移行期間中そのまま照合する。
function lookupKey(token: string): string {
  return token.startsWith(SESSION_TOKEN_PREFIX) ? hashToken(token) : token;
}

// S-5: ユーザー不在時に verifyPassword を実行するためのダミーハッシュ（固定値・実在パスワードなし）。
// scryptSync のコストを実在ユーザーへの検証と同等に発生させ、タイミング差によるアカウント列挙を防ぐ。
export const DUMMY_PASSWORD_HASH =
  "97a435db29a5b77183be4c7d72939e68:6076b9ba9f6ba3b1192f5877d1847504e8ca63eac02f21dfdc7eca969ebad217d32d789fe392d42f527d50653594724a65eed1d0ff4d9a4b97323deeb69a984e";

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

function clientMeta(req?: NextRequest): { ip?: string; userAgent?: string } {
  if (!req) return {};
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { ip, userAgent };
}

// ログイン: セッションを作成し Cookie を設定する。トークンを返す（モバイルは Bearer として使用）。
// ログイン成功時は常に新規トークンを発行する（セッション固定攻撃対策）。
export async function createSession(userId: number, req?: NextRequest): Promise<string> {
  const token = SESSION_TOKEN_PREFIX + randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS);
  const { ip, userAgent } = clientMeta(req);
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt, lastSeenAt: now, ip, userAgent },
  });

  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return token;
}

function resolveRequestToken(reqHeaders: Headers, cookieToken: string | undefined): string | null {
  const auth = reqHeaders.get("authorization");
  const bearerToken = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  return bearerToken ?? cookieToken ?? null;
}

// 現在のリクエストのログインユーザーを取得する（未ログインなら null）
// Cookie（Web）または Authorization: Bearer <token>（モバイル）の両方に対応
export async function getCurrentUser() {
  const reqHeaders = await headers();
  const store = await cookies();
  const token = resolveRequestToken(reqHeaders, store.get(sessionCookieName())?.value);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: lookupKey(token) },
    include: { user: true },
  });
  if (!session) return null;

  const now = new Date();
  if (session.expiresAt < now) return null; // 絶対期限
  if (session.lastSeenAt.getTime() + IDLE_TTL_MS < now.getTime()) return null; // アイドルタイムアウト

  // 書き込み頻度を抑えるため、一定時間以上古い場合のみ lastSeenAt を更新する
  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_UPDATE_THRESHOLD_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: now } })
      .catch(() => {});
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _passwordHash, ...user } = session.user;
  return user; // includes tenantId
}

// ログアウト: セッションを削除し Cookie をクリアする。Cookie（Web）/ Bearer（モバイル）の両方に対応。
export async function destroySession(): Promise<void> {
  const reqHeaders = await headers();
  const store = await cookies();
  const cookieToken = store.get(sessionCookieName())?.value;
  const token = resolveRequestToken(reqHeaders, cookieToken);

  if (token) {
    await prisma.session.deleteMany({ where: { id: lookupKey(token) } });
  }
  if (cookieToken) {
    store.delete(sessionCookieName());
  }
}

// 指定ユーザーの全セッションを失効させる（パスワード変更・ロール変更時）。
export async function invalidateAllSessions(userId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
