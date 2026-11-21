import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  linkDenied,
  mobileRedirectAllowed,
  parseJwks,
  pkceChallenge,
  Rejected,
  verifyIdToken,
  verifyPkce,
} from "./oidc";
import { claims, Signer, TEST_CLIENT_ID, TEST_ISSUER } from "./sso-test-idp";

const rsa = new Signer("RS256", "rsa-1");
const ed = new Signer("EdDSA", "ed-1");
const ec = new Signer("ES256", "ec-1");
const keys = parseJwks({ keys: [rsa.jwk, ed.jwk, ec.jwk] });
const b64 = (s: Buffer | string) => Buffer.from(s).toString("base64url");

const verify = (token: string, requireMfa = true) =>
  verifyIdToken(token, keys, { issuer: TEST_ISSUER, clientId: TEST_CLIENT_ID, nonce: "n0nce", requireMfa });

function rejected(token: string, requireMfa = true): string | null {
  try {
    verify(token, requireMfa);
    return null;
  } catch (e) {
    if (e instanceof Rejected) return e.reason;
    throw e;
  }
}

describe("verifyIdToken", () => {
  it("各方式の正しいトークンを受け付ける", () => {
    for (const s of [rsa, ed, ec]) expect(verify(s.sign(claims())).sub).toBe("sub-1");
  });

  it("正しくないトークンを断る", () => {
    const other = new Signer("RS256", "rsa-1"); // 同じ kid の別の鍵
    expect(rejected(other.sign(claims()))).toBe("signature");
    const [head, , sig] = rsa.sign(claims()).split(".");
    expect(rejected(`${head}.${b64(JSON.stringify(claims({ sub: "x" })))}.${sig}`)).toBe("signature");
    // HS256（公開鍵を共通鍵として使わせる攻撃）と none
    const h = b64(JSON.stringify({ alg: "HS256", kid: "rsa-1" }));
    const b = b64(JSON.stringify(claims()));
    const mac = createHmac("sha256", JSON.stringify(rsa.jwk)).update(`${h}.${b}`).digest();
    expect(rejected(`${h}.${b}.${b64(mac)}`)).toBe("alg");
    expect(rejected(`${b64(JSON.stringify({ alg: "none", kid: "rsa-1" }))}.${b}.`)).toBe("alg");
    expect(rejected(rsa.sign(claims(), { alg: "PS256" }))).toBe("alg_mismatch");
    expect(rejected(rsa.sign(claims(), { kid: "nope" }))).toBe("unknown_kid");
    expect(rejected(rsa.sign(claims({ iss: "https://evil.test/auth/v1" })))).toBe("iss");
    expect(rejected(rsa.sign(claims({ aud: "other" })))).toBe("aud");
    expect(rejected(rsa.sign(claims({ aud: [TEST_CLIENT_ID, "other"] })))).toBe("azp");
    expect(verify(rsa.sign(claims({ aud: [TEST_CLIENT_ID, "other"], azp: TEST_CLIENT_ID }))).sub).toBe("sub-1");
    expect(rejected(rsa.sign(claims({ exp: Math.floor(Date.now() / 1000) - 120 })))).toBe("exp");
    expect(rejected(rsa.sign(claims({ exp: undefined })))).toBe("exp");
    expect(rejected(rsa.sign(claims({ nonce: "other" })))).toBe("nonce");
    expect(rejected(rsa.sign(claims({ sub: "" })))).toBe("sub");
    expect(rejected(rsa.sign(claims({ amr: ["pwd"] })))).toBe("mfa_required");
    expect(verify(rsa.sign(claims({ amr: ["pwd"] })), false).sub).toBe("sub-1");
    expect(rejected("not.a.jwt")).toBe("header");
  });
});

describe("PKCE・戻り先・デモ用ドメイン", () => {
  it("RFC 7636 の付録 B の例", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(v)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(v, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("short", pkceChallenge("short"))).toBe(false);
  });

  it("モバイルの戻り先とデモ用ドメイン", () => {
    const prefixes = ["kakei://", "exp://"];
    expect(mobileRedirectAllowed("kakei://auth/sso", prefixes)).toBe(true);
    expect(mobileRedirectAllowed("exp://192.168.0.2:8081/--/auth/sso", prefixes)).toBe(true);
    for (const bad of ["https://evil.test/", "http://x/", "evil://auth/sso", "kakei://auth/sso#x", ""]) {
      expect(mobileRedirectAllowed(bad, prefixes)).toBe(false);
    }
    expect(linkDenied("demo@example.com", ["example.com"])).toBe(true);
    expect(linkDenied("no-at-mark", ["example.com"])).toBe(true);
    expect(linkDenied("me@family.test", ["example.com"])).toBe(false);
  });
});
