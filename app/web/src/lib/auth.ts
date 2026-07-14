import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCookieSecure, sessionCookieName, SESSION_TOKEN_PREFIX } from "@/lib/session-constants";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

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

// S-6: パスワードハッシュ形式。新形式は `scrypt$N$r$p$salt$hash`（パラメータを埋め込むことで
// 将来のコストパラメータ変更後も旧ハッシュを正しく検証できる）。旧形式（`salt:hash`。固定パラメータ
// N=16384 r=8 p=1 = Node のデフォルト値）は引き続き verifyPassword で検証でき、ログイン成功時に
// 透過的に新形式へ再ハッシュされる（呼び出し側は isLegacyPasswordHash() で判定する）。
const HASH_PREFIX = "scrypt";
const SCRYPT_N = 32768; // 2^15（旧デフォルトの 2 倍のコスト）
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
// scrypt の必要メモリは概ね 128 * N * r バイト（新パラメータで 32MiB）。
// Node のデフォルト上限（32MiB）ちょうどで ERR_CRYPTO_INVALID_SCRYPT_PARAMS になり得るため余裕を持たせる。
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// S-5: ユーザー不在時に verifyPassword を実行するためのダミーハッシュ（固定値・実在パスワードなし）。
// 新形式と同じコストを発生させ、実在ユーザーとの処理時間差によるアカウント列挙を防ぐ。
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$54556891c140d3f0c0f4648937b6836d$554c6cb76736339bae30b4b9a73622ae1238435992a3a81d5c7cbe46fc6475423a534633211babaed8e53e80e423df8f7518ebe8e4e335fca803cb4fdbb70e47";

// 旧形式（`salt:hash`）で保存されたハッシュかどうかを判定する（ログイン成功時の透過再ハッシュ判定用）
export function isLegacyPasswordHash(stored: string): boolean {
  return !stored.startsWith(`${HASH_PREFIX}$`);
}

// パスワードを scrypt でハッシュ化する（外部依存なし。非同期のためイベントループをブロックしない）
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `${HASH_PREFIX}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("hex")}`;
}

// 平文パスワードとハッシュを比較する。新形式・旧形式の両方に対応する。
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyPasswordHash(stored)) {
    const [salt, key] = stored.split(":");
    if (!salt || !key) return false;
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: SCRYPT_MAXMEM,
    });
    const keyBuf = Buffer.from(key, "hex");
    return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
  }

  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, nStr, rStr, pStr, salt, key] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !key) {
    return false;
  }
  const keyBuf = Buffer.from(key, "hex");
  const derived = await scryptAsync(password, salt, keyBuf.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
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
