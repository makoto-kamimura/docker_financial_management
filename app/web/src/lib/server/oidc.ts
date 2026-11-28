// SSO（OpenID Connect）のクライアント。接続先は設定の発行元（OIDC_ISSUER）だけで決まり、
// エンドポイントと公開鍵は /.well-known/openid-configuration から読む。
//
// 乗っ取りを防ぐ要（認証サーバーのリポジトリの docs/runbooks/app-integration.md の 2.2）:
// - ID トークンは公開鍵（JWKS）で署名を確かめ、iss・aud・exp・nonce も確かめる
// - 利用者の特定には sub だけを使う
// - 戻ったあとは使い捨ての結果コードを返し、開始したクライアントの code_verifier と引き換える
//
// 署名の確認は node:crypto で直接行う（許す方式を明示し、鍵の種類と方式の取り違えを起こさないため）。
import {
  constants,
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

export const PROVIDER = "sso";
export const LOGIN_PASSWORD = "pwd";
export const LOGIN_SSO = "sso";
export type LoginMethod = typeof LOGIN_PASSWORD | typeof LOGIN_SSO;

const CACHE_TTL_MS = 3600_000; // 設定の公開と公開鍵を読み直す間隔
export const JWKS_FORCE_REFRESH_MIN_MS = 10_000; // 知らない kid のときに公開鍵を読み直してよい最短の間隔
const LEEWAY_S = 60; // 時計のずれの許容
// ID トークンの署名に許す方式。共通鍵（HS*）と none は許さない
const ALLOWED_ALGS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "EdDSA"];

export class Rejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

// ── 設定 ─────────────────────────────────────────────────────────────

const env = (name: string, fallback = "") => (process.env[name] ?? fallback).trim();
const list = (name: string, fallback: string) =>
  env(name, fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const flag = (name: string, fallback: boolean) =>
  ["true", "1", "yes"].includes(env(name, fallback ? "true" : "false").toLowerCase());

export const oidcConfig = () => ({
  issuer: env("OIDC_ISSUER"),
  clientId: env("OIDC_CLIENT_ID"),
  clientSecret: env("OIDC_CLIENT_SECRET"),
  publicBaseUrl: env("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  displayName: env("OIDC_DISPLAY_NAME", "SSO") || "SSO",
  scope: env("OIDC_SCOPE", "openid email profile") || "openid email profile",
  requireMfa: flag("OIDC_REQUIRE_MFA", true),
  mobileRedirectPrefixes: list("OIDC_MOBILE_REDIRECT_PREFIXES", "kakei://,exp://"),
  linkDenyDomains: list("OIDC_LINK_DENY_EMAIL_DOMAINS", "example.com").map((d) => d.toLowerCase()),
  allowPasswordForSsoOnly: flag("OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY", false),
});

export function ssoEnabled(): boolean {
  const c = oidcConfig();
  return !!(c.issuer && c.clientId && c.clientSecret && c.publicBaseUrl);
}

export const callbackUrl = () => `${oidcConfig().publicBaseUrl}/api/auth/sso/callback`;
export const webReturnUrl = () => `${oidcConfig().publicBaseUrl}/auth/sso/complete`;

/**
 * このログイン方法（pwd / sso）を、この利用者に許すか（「SSO だけ」の判定）。
 * SSO が無効な環境と、非常用の切り替え（OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY）では、パスワードも許す。
 */
export function loginMethodAllowed(user: { ssoOnly: boolean }, method: string): boolean {
  if (method === LOGIN_SSO || !user.ssoOnly) return true;
  return !ssoEnabled() || oidcConfig().allowPasswordForSsoOnly;
}

// ── 乱数・PKCE・戻り先 ─────────────────────────────────────────────────

/** 推測できない 32 バイトの乱数（base64url、43 文字） */
export const randomToken = () => randomBytes(32).toString("base64url");

/** DB に保存するためのハッシュ。トークンそのものは保存しない */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export const isValidVerifier = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
export const isValidChallenge = (c: unknown): c is string =>
  typeof c === "string" && /^[A-Za-z0-9\-_]{43}$/.test(c);

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isValidVerifier(verifier)) return false;
  const a = Buffer.from(challenge);
  const b = Buffer.from(pkceChallenge(verifier));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** モバイルの戻り先が許可リストの先頭に一致するか（http・https・フラグメント付きは拒否） */
export function mobileRedirectAllowed(uri: string, prefixes: string[]): boolean {
  if (typeof uri !== "string" || uri.includes("#")) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
  if (!scheme || scheme === "http" || scheme === "https") return false;
  return prefixes.some((p) => p !== "" && uri.startsWith(p));
}

export const withQuery = (base: string, key: string, value: string) =>
  `${base}${base.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;

/** このメールアドレスの利用者に連携させないか（デモ用アカウント） */
export function linkDenied(email: string, denyDomains: string[]): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return true;
  return denyDomains.includes(e.slice(at + 1));
}

// ── ID トークンの確認 ─────────────────────────────────────────────────

export type Jwk = { kid: string; kty: string; alg?: string; key: KeyObject };

/** 公開鍵の一覧（JWKS）から、読めた署名用の鍵だけを kid => Jwk にする（知らない種類の鍵は飛ばす） */
export function parseJwks(jwks: unknown): Map<string, Jwk> {
  const keys = new Map<string, Jwk>();
  const arr = (jwks as { keys?: unknown })?.keys;
  if (!Array.isArray(arr)) return keys;
  for (const jwk of arr as Record<string, unknown>[]) {
    if (!jwk || typeof jwk !== "object" || typeof jwk.kid !== "string" || !jwk.kid) continue;
    if ((jwk.use ?? "sig") !== "sig") continue;
    const kty = jwk.kty;
    const supported =
      kty === "RSA" ||
      (kty === "EC" && jwk.crv === "P-256") ||
      (kty === "OKP" && jwk.crv === "Ed25519");
    if (!supported) continue;
    try {
      const key = createPublicKey({ key: jwk as never, format: "jwk" });
      keys.set(jwk.kid, {
        kid: jwk.kid,
        kty: kty as string,
        alg: typeof jwk.alg === "string" ? jwk.alg : undefined,
        key,
      });
    } catch {
      // 使えない鍵は飛ばす
    }
  }
  return keys;
}

function b64urlDecode(s: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  return Buffer.from(s, "base64url");
}

export function header(token: string): Record<string, unknown> | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const h = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    return h && typeof h === "object" && !Array.isArray(h) ? h : null;
  } catch {
    return null;
  }
}

/** 方式と鍵の種類が合わなければ、署名を見る前に断る（RS 鍵で別の方式を名乗らせない） */
function verifySignature(alg: string, jwk: Jwk, data: Buffer, sig: Buffer): void {
  const digest = `sha${alg.slice(2)}`;
  let ok: boolean;
  if (alg.startsWith("RS") && jwk.kty === "RSA") {
    ok = cryptoVerify(digest, data, { key: jwk.key, padding: constants.RSA_PKCS1_PADDING }, sig);
  } else if (alg.startsWith("PS") && jwk.kty === "RSA") {
    ok = cryptoVerify(
      digest,
      data,
      {
        key: jwk.key,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      sig,
    );
  } else if (alg === "ES256" && jwk.kty === "EC") {
    if (sig.length !== 64) throw new Rejected("signature");
    ok = cryptoVerify("sha256", data, { key: jwk.key, dsaEncoding: "ieee-p1363" }, sig);
  } else if (alg === "EdDSA" && jwk.kty === "OKP") {
    ok = cryptoVerify(null, data, jwk.key, sig);
  } else {
    throw new Rejected("alg_mismatch");
  }
  if (!ok) throw new Rejected("signature");
}

/** ID トークンの署名と中身を確かめて claims を返す。受け付けないときは Rejected */
export function verifyIdToken(
  token: string,
  keys: Map<string, Jwk>,
  opts: { issuer: string; clientId: string; nonce: string; requireMfa: boolean; now?: number },
): Record<string, unknown> {
  const h = header(token);
  if (!h) throw new Rejected("header");
  const alg = h.alg;
  if (typeof alg !== "string" || !ALLOWED_ALGS.includes(alg)) throw new Rejected("alg");
  const kid = h.kid;
  if (typeof kid !== "string" || !kid) throw new Rejected("kid");
  const jwk = keys.get(kid);
  if (!jwk) throw new Rejected("unknown_kid");
  if (jwk.alg !== undefined && jwk.alg !== alg) throw new Rejected("alg_mismatch");

  const [head, body, sig] = token.split(".");
  let signature: Buffer;
  try {
    signature = b64urlDecode(sig);
  } catch {
    throw new Rejected("signature");
  }
  try {
    verifySignature(alg, jwk, Buffer.from(`${head}.${body}`), signature);
  } catch (e) {
    if (e instanceof Rejected) throw e;
    throw new Rejected("signature");
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    throw new Rejected("claims");
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Rejected("claims");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!num(claims.exp) || claims.exp + LEEWAY_S < now) throw new Rejected("exp");
  if (num(claims.nbf) && claims.nbf - LEEWAY_S > now) throw new Rejected("nbf");
  if (num(claims.iat) && claims.iat - LEEWAY_S > now) throw new Rejected("iat");
  // 設定の公開に書かれた発行元と完全に一致すること
  if (claims.iss !== opts.issuer) throw new Rejected("iss");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.clientId)) throw new Rejected("aud");
  if (auds.length > 1 && claims.azp !== opts.clientId) throw new Rejected("azp");
  const got = claims.nonce;
  if (typeof got !== "string") throw new Rejected("nonce");
  const a = Buffer.from(got);
  const b = Buffer.from(opts.nonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Rejected("nonce");
  const sub = claims.sub;
  if (typeof sub !== "string" || !sub || Buffer.byteLength(sub) > 255) throw new Rejected("sub");
  if (opts.requireMfa && !(Array.isArray(claims.amr) && claims.amr.includes("mfa"))) {
    throw new Rejected("mfa_required");
  }
  return claims;
}

/** 末尾の / だけが違う発行元は同じとみなす（設定の書き方の揺れ） */
export const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

// ── 認証サーバーとの通信（起動時には取りに行かない）。キャッシュはプロセスごと ──────────

type Metadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};
const cache: { metadata?: [number, Metadata]; jwks?: [number, unknown] } = {};

export function resetOidcCache(): void {
  delete cache.metadata;
  delete cache.jwks;
}

// テストで差し替える（偽の認証サーバー・時計）
export const oidcIo = {
  now: () => Date.now(),
  async getJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status !== 200) throw new Error(`GET ${url} returned ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error(`GET ${url}: not a JSON object`);
    return data;
  },
  async postForm(
    url: string,
    form: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return { status: res.status, body: await res.text() };
  },
};

function origin(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`.toLowerCase();
}

/** 設定の公開を読む。発行元が設定と違う、エンドポイントが発行元と別のオリジン、なら使わない */
export async function metadata(): Promise<Metadata> {
  const hit = cache.metadata;
  if (hit && oidcIo.now() - hit[0] < CACHE_TTL_MS) return hit[1];
  const issuer = oidcConfig().issuer;
  const meta = await oidcIo.getJson(
    `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
  );
  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (typeof meta[k] !== "string" || !meta[k]) throw new Error(`discovery document has no ${k}`);
  }
  const m = meta as unknown as Metadata;
  if (!sameIssuer(m.issuer, issuer))
    throw new Error(`discovery issuer ${m.issuer} does not match OIDC_ISSUER`);
  const o = origin(m.issuer);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (origin(m[k]) !== o) throw new Error(`${k} is not on the issuer's origin`);
  }
  cache.metadata = [oidcIo.now(), m];
  return m;
}

async function jwks(force: boolean): Promise<Map<string, Jwk>> {
  const hit = cache.jwks;
  if (hit) {
    const age = oidcIo.now() - hit[0];
    if ((!force && age < CACHE_TTL_MS) || (force && age < JWKS_FORCE_REFRESH_MIN_MS))
      return parseJwks(hit[1]);
  }
  const raw = await oidcIo.getJson((await metadata()).jwks_uri);
  if (parseJwks(raw).size === 0) throw new Error("JWKS has no usable keys");
  cache.jwks = [oidcIo.now(), raw];
  return parseJwks(raw);
}

export async function authorizationUrl(
  state: string,
  nonce: string,
  serverChallenge: string,
): Promise<string> {
  const c = oidcConfig();
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: c.scope,
    state,
    nonce,
    code_challenge: serverChallenge,
    code_challenge_method: "S256",
  })
    .toString()
    .replace(/\+/g, "%20");
  const endpoint = (await metadata()).authorization_endpoint;
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${q}`;
}

/** 認可コードを交換して ID トークンを返す */
export async function exchangeCode(code: string, serverVerifier: string): Promise<string> {
  const c = oidcConfig();
  const { status, body } = await oidcIo.postForm((await metadata()).token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code_verifier: serverVerifier,
  });
  // 応答には秘密は含まれない（error と error_description だけ）
  if (status !== 200) throw new Error(`token endpoint returned ${status}: ${body.slice(0, 200)}`);
  const idToken = (JSON.parse(body) as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string" || !idToken) throw new Error("token response has no id_token");
  return idToken;
}

/** ID トークンを確かめる。知らない鍵（鍵の入れ替え直後）なら、公開鍵を 1 回だけ読み直す */
export async function verifyWithIdp(
  idToken: string,
  nonce: string,
): Promise<Record<string, unknown>> {
  const { issuer } = await metadata();
  const c = oidcConfig();
  const check = (keys: Map<string, Jwk>) =>
    verifyIdToken(idToken, keys, { issuer, clientId: c.clientId, nonce, requireMfa: c.requireMfa });
  try {
    return check(await jwks(false));
  } catch (e) {
    if (!(e instanceof Rejected) || e.reason !== "unknown_kid") throw e;
    return check(await jwks(true));
  }
}
