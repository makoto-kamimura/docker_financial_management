// SSO のテスト用: 本物の鍵で ID トークンに署名する偽の認証サーバー（oidcIo に差し込む）
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";

export const TEST_ISSUER = "https://auth.test/auth/v1";
export const TEST_CLIENT_ID = "financial";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export class Signer {
  readonly jwk: Record<string, unknown>;
  private readonly key: KeyObject;

  constructor(
    readonly kind: "RS256" | "EdDSA" | "ES256",
    readonly kid: string,
  ) {
    const pair =
      kind === "RS256"
        ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        : kind === "EdDSA"
          ? generateKeyPairSync("ed25519")
          : generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.key = pair.privateKey;
    this.jwk = { ...pair.publicKey.export({ format: "jwk" }), kid, alg: kind, use: "sig" };
  }

  sign(claims: Record<string, unknown>, opts: { alg?: string; kid?: string } = {}): string {
    const head = b64(JSON.stringify({ alg: opts.alg ?? this.kind, kid: opts.kid ?? this.kid, typ: "JWT" }));
    const body = b64(JSON.stringify(claims));
    const data = Buffer.from(`${head}.${body}`);
    const sig =
      this.kind === "RS256"
        ? cryptoSign("sha256", data, this.key)
        : this.kind === "EdDSA"
          ? cryptoSign(null, data, this.key)
          : cryptoSign("sha256", data, { key: this.key, dsaEncoding: "ieee-p1363" });
    return `${head}.${body}.${b64(sig)}`;
  }
}

export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const c: Record<string, unknown> = {
    iss: TEST_ISSUER,
    aud: TEST_CLIENT_ID,
    sub: "sub-1",
    exp: now + 300,
    iat: now,
    nonce: "n0nce",
    amr: ["pwd", "mfa"],
    email: "me@family.test",
    ...over,
  };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return c;
}

/** 認可コードと PKCE を確かめ、ID トークンを返す偽の認証サーバー */
export class FakeIdp {
  private codes = new Map<string, { q: URLSearchParams; sub: string; amr: string[] }>();
  jwksHits = 0;

  constructor(public signer: Signer) {}

  authorize(url: string, sub = "sub-1", amr = ["pwd", "mfa"]): string {
    const q = new URL(url).searchParams;
    if (q.get("client_id") !== TEST_CLIENT_ID || q.get("code_challenge_method") !== "S256") throw new Error("bad client");
    const code = randomBytes(8).toString("hex");
    this.codes.set(code, { q, sub, amr });
    return `${q.get("redirect_uri")}?code=${code}&state=${q.get("state")}`;
  }

  async getJson(url: string): Promise<Record<string, unknown>> {
    if (url.endsWith("/.well-known/openid-configuration")) {
      return {
        issuer: TEST_ISSUER,
        authorization_endpoint: `${TEST_ISSUER}/oidc/authorize`,
        token_endpoint: `${TEST_ISSUER}/oidc/token`,
        jwks_uri: `${TEST_ISSUER}/oidc/certs`,
      };
    }
    if (url.endsWith("/oidc/certs")) {
      this.jwksHits += 1;
      return { keys: [this.signer.jwk] };
    }
    throw new Error(`GET ${url} returned 404`);
  }

  async postForm(_url: string, form: Record<string, string>): Promise<{ status: number; body: string }> {
    const entry = this.codes.get(form.code);
    this.codes.delete(form.code);
    if (!entry || form.client_secret !== "s3cret") return { status: 400, body: '{"error":"invalid_grant"}' };
    const challenge = createHash("sha256").update(form.code_verifier).digest("base64url");
    if (challenge !== entry.q.get("code_challenge") || form.redirect_uri !== entry.q.get("redirect_uri")) {
      return { status: 400, body: '{"error":"invalid_grant"}' };
    }
    const token = this.signer.sign(claims({ sub: entry.sub, nonce: entry.q.get("nonce"), amr: entry.amr }));
    return { status: 200, body: JSON.stringify({ id_token: token, access_token: "x", token_type: "Bearer" }) };
  }
}

export const SSO_TEST_ENV: Record<string, string> = {
  OIDC_ISSUER: TEST_ISSUER,
  OIDC_CLIENT_ID: TEST_CLIENT_ID,
  OIDC_CLIENT_SECRET: "s3cret",
  PUBLIC_BASE_URL: "https://financial.test",
  OIDC_REQUIRE_MFA: "true",
  OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY: "false",
};
