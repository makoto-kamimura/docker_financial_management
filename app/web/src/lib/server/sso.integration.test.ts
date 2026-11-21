/**
 * SSO（OpenID Connect）の結合テスト。実 DB と、偽の認証サーバー（本物の鍵で署名）を使う。
 * 連携 → SSO でログイン（このアプリの MFA は求めない）→「SSO だけ」→ 解除、と守り（使い捨て・PKCE・本人確認）を確かめる。
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// next/headers（Cookie とヘッダー）を差し替える。Cookie は 1 つの入れ物、ヘッダーは Authorization だけ
const jar = new Map<string, string>();
let bearer: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}),
}));

import { prisma } from "@/lib/server/prisma";
import { hashPassword } from "@/lib/server/auth";
import {
  oidcIo,
  pkceChallenge,
  resetOidcCache,
  JWKS_FORCE_REFRESH_MIN_MS,
} from "@/lib/server/oidc";
import { FakeIdp, SSO_TEST_ENV, Signer } from "@/lib/server/sso-test-idp";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as meGet } from "@/app/api/auth/me/route";
import { GET as providersGet } from "@/app/api/auth/providers/route";
import { GET as startGet } from "@/app/api/auth/sso/start/route";
import { GET as callbackGet } from "@/app/api/auth/sso/callback/route";
import { POST as exchangePost } from "@/app/api/auth/sso/exchange/route";
import { GET as identitiesGet } from "@/app/api/me/identities/route";
import { POST as intentPost } from "@/app/api/me/identities/sso/intent/route";
import { DELETE as unlinkDelete } from "@/app/api/me/identities/sso/route";
import { PUT as ssoOnlyPut } from "@/app/api/me/sso-only/route";
import { GET as webStart } from "@/app/auth/sso/start/route";
import { GET as webComplete } from "@/app/auth/sso/complete/route";

const SUFFIX = randomBytes(4).toString("hex");
const BASE = "https://financial.test";
const MOBILE_RETURN = "kakei://auth/sso";
const SESSION_COOKIE = "fm_session";
const idp = new FakeIdp(new Signer("RS256", "rsa-1"));
const realIo = { ...oidcIo };
let tenantId: number;
const ids: Record<"me" | "other" | "demo", number> = { me: 0, other: 0, demo: 0 };
const email = {
  me: `me_${SUFFIX}@family.test`,
  other: `you_${SUFFIX}@family.test`,
  demo: `demo_${SUFFIX}@example.com`,
};

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`,
    "x-requested-with": "fm-mobile",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(new URL(url, BASE), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** 名前を付けたトークンで以降のリクエストを送る（null で未ログイン） */
function as(token: string | null) {
  bearer = token;
  jar.clear();
}

async function pwdLogin(who: keyof typeof email, password = "pw-1234-secret") {
  as(null);
  const res = await loginPost(
    req("/api/auth/login", { method: "POST", body: { email: email[who], password } }),
  );
  const json = await res.json().catch(() => ({}));
  return { status: res.status, token: json?.data?.sessionId as string | undefined, json };
}

const verifier = () => randomBytes(32).toString("base64url");
const query = (loc: string) => new URLSearchParams(loc.split("?")[1] ?? "");

/** モバイルの流れを通し、交換の応答（または戻り先の error）を返す */
async function runFlow(
  mode: "login" | "link",
  token: string | null = null,
  sub = "sub-1",
  amr = ["pwd", "mfa"],
) {
  const v = verifier();
  const params = new URLSearchParams({
    mode,
    client: "mobile",
    code_challenge: pkceChallenge(v),
    redirect_uri: MOBILE_RETURN,
  });
  if (mode === "link") {
    as(token);
    params.set("intent", (await (await intentPost()).json()).intent);
  }
  as(null);
  const s = await startGet(req(`/api/auth/sso/start?${params}`));
  expect(s.status).toBe(303);
  const back = idp.authorize(s.headers.get("location")!, sub, amr);
  const cb = await callbackGet(req(back));
  expect(cb.status).toBe(303);
  const loc = cb.headers.get("location")!;
  expect(loc.startsWith(`${MOBILE_RETURN}?`)).toBe(true);
  const q = query(loc);
  if (q.get("error")) return q.get("error")!;
  as(token);
  return exchangePost(
    req("/api/auth/sso/exchange", {
      method: "POST",
      body: { code: q.get("code"), code_verifier: v },
    }),
  );
}

beforeAll(async () => {
  Object.assign(process.env, SSO_TEST_ENV);
  oidcIo.getJson = (url) => idp.getJson(url);
  oidcIo.postForm = (url, form) => idp.postForm(url, form);
  const tenant = await prisma.tenant.create({ data: { name: `SsoTenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const passwordHash = await hashPassword("pw-1234-secret");
  for (const who of ["me", "other", "demo"] as const) {
    const u = await prisma.user.create({
      data: { tenantId, email: email[who], name: who, passwordHash, role: "admin" },
    });
    ids[who] = u.id;
  }
});

beforeEach(async () => {
  resetOidcCache();
  idp.signer = new Signer("RS256", "rsa-1");
  idp.jwksHits = 0;
  oidcIo.now = realIo.now;
  const userIds = Object.values(ids);
  await prisma.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.oauthFlow.deleteMany({});
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: {
      ssoOnly: false,
      mfaEnabled: false,
      totpSecret: null,
      loginAttempts: 0,
      lockedUntil: null,
    },
  });
});

afterAll(async () => {
  const userIds = Object.values(ids);
  await prisma.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.oauthFlow.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.mfaChallenge.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  Object.assign(oidcIo, realIo);
  await prisma.$disconnect();
});

describe("SSO", () => {
  it("設定がなければ無効", async () => {
    const saved = process.env.OIDC_CLIENT_SECRET;
    process.env.OIDC_CLIENT_SECRET = "";
    try {
      expect(await (await providersGet()).json()).toEqual({ sso: false, sso_name: null });
      expect((await startGet(req("/api/auth/sso/start?mode=login"))).status).toBe(404);
    } finally {
      process.env.OIDC_CLIENT_SECRET = saved;
    }
  });

  it("連携 → SSO でログイン → 「SSO だけ」→ 解除", async () => {
    expect(await runFlow("login")).toBe("not_linked");

    const pwd = (await pwdLogin("me")).token!;
    as(pwd);
    const before = await (await identitiesGet()).json();
    expect(before).toMatchObject({
      sso_enabled: true,
      can_link: true,
      identities: [],
      login_method: "pwd",
    });
    const linked = (await runFlow("link", pwd)) as Response;
    expect(linked.status).toBe(200);
    expect(await linked.json()).toEqual({ mode: "link", email: "me@family.test" });

    const res = (await runFlow("login")) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("login");
    const sso = body.data.sessionId as string;
    as(sso);
    expect((await meGet()).status).toBe(200);

    // 「SSO だけ」はパスワードのログインではオンにできない
    as(pwd);
    expect(
      (await ssoOnlyPut(req("/api/me/sso-only", { method: "PUT", body: { enabled: true } })))
        .status,
    ).toBe(400);
    as(sso);
    const on = await ssoOnlyPut(
      req("/api/me/sso-only", { method: "PUT", body: { enabled: true } }),
    );
    expect(await on.json()).toEqual({ sso_only: true });
    // パスワードのセッションは、ほかの端末のものもその時点から 401。パスワードのログインは 403（違えば 401）
    as(pwd);
    expect((await meGet()).status).toBe(401);
    expect((await pwdLogin("me")).status).toBe(403);
    expect((await pwdLogin("me", "wrong-password")).status).toBe(401);
    as(sso);
    expect((await meGet()).status).toBe(200);
    expect(await (await identitiesGet()).json()).toMatchObject({
      login_method: "sso",
      sso_only: true,
    });

    // 非常用の切り替え
    process.env.OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY = "true";
    try {
      expect((await pwdLogin("me")).status).toBe(200);
    } finally {
      process.env.OIDC_ALLOW_PASSWORD_FOR_SSO_ONLY = "false";
    }

    // 解除すると「SSO だけ」も外れ、SSO では入れなくなる
    as(sso);
    expect(
      await (await unlinkDelete(req("/api/me/identities/sso", { method: "DELETE" }))).json(),
    ).toEqual({ unlinked: true });
    expect((await pwdLogin("me")).status).toBe(200);
    expect(await runFlow("login")).toBe("not_linked");
  });

  it("このアプリの MFA（TOTP）を有効にしていても、SSO のログインでは求めない", async () => {
    const pwd = (await pwdLogin("me")).token!;
    expect(((await runFlow("link", pwd)) as Response).status).toBe(200);
    await prisma.user.update({
      where: { id: ids.me },
      data: { mfaEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" },
    });
    const p = await pwdLogin("me");
    expect(p.status).toBe(401);
    expect(p.json.mfaRequired).toBe(true);
    const res = (await runFlow("login")) as Response;
    expect(res.status).toBe(200);
    // ただし認証サーバーにパスキーで入っていなければ断る
    expect(await runFlow("login", null, "sub-1", ["pwd"])).toBe("mfa_required");
  });

  it("結果コードは 1 回だけ、code_verifier がないと交換できない", async () => {
    const pwd = (await pwdLogin("me")).token!;
    expect(((await runFlow("link", pwd)) as Response).status).toBe(200);
    as(null);
    const v = verifier();
    const params = new URLSearchParams({
      mode: "login",
      client: "mobile",
      code_challenge: pkceChallenge(v),
      redirect_uri: MOBILE_RETURN,
    });
    const s = await startGet(req(`/api/auth/sso/start?${params}`));
    const back = idp.authorize(s.headers.get("location")!);
    const code = query((await callbackGet(req(back))).headers.get("location")!).get("code");
    const ex = (cv: string) =>
      exchangePost(
        req("/api/auth/sso/exchange", { method: "POST", body: { code, code_verifier: cv } }),
      );
    expect((await ex(verifier())).status).toBe(401);
    expect((await ex(v)).status).toBe(401);
    // state の再利用は 400
    expect((await callbackGet(req(back))).status).toBe(400);
  });

  it("連携の守り（デモ用・他人の intent・1 対 1）", async () => {
    const demo = (await pwdLogin("demo")).token!;
    as(demo);
    expect((await (await identitiesGet()).json()).can_link).toBe(false);
    expect((await intentPost()).status).toBe(400);

    const mine = (await pwdLogin("me")).token!;
    const theirs = (await pwdLogin("other")).token!;
    // 他人の intent で始めた連携を、自分のセッションで交換しても通らない
    as(theirs);
    const intent = (await (await intentPost()).json()).intent;
    as(null);
    const v = verifier();
    const params = new URLSearchParams({
      mode: "link",
      client: "mobile",
      code_challenge: pkceChallenge(v),
      redirect_uri: MOBILE_RETURN,
      intent,
    });
    const s = await startGet(req(`/api/auth/sso/start?${params}`));
    const back = idp.authorize(s.headers.get("location")!);
    const code = query((await callbackGet(req(back))).headers.get("location")!).get("code");
    as(mine);
    expect(
      (
        await exchangePost(
          req("/api/auth/sso/exchange", { method: "POST", body: { code, code_verifier: v } }),
        )
      ).status,
    ).toBe(403);
    // intent は 1 回だけ
    as(null);
    const again = await startGet(req(`/api/auth/sso/start?${params}`));
    expect(again.headers.get("location")).toContain("error=expired");

    expect(((await runFlow("link", mine)) as Response).status).toBe(200);
    expect(((await runFlow("link", theirs)) as Response).status).toBe(409);
    expect(((await runFlow("link", mine, "sub-2")) as Response).status).toBe(409);
  });

  it("中止と戻り先の確認", async () => {
    as(null);
    const v = verifier();
    const s = await startGet(
      req(`/api/auth/sso/start?mode=login&client=web&code_challenge=${pkceChallenge(v)}`),
    );
    const state = new URL(s.headers.get("location")!).searchParams.get("state")!;
    const cb = await callbackGet(req(`/api/auth/sso/callback?error=access_denied&state=${state}`));
    expect(cb.headers.get("location")).toBe(`${BASE}/auth/sso/complete?error=cancelled`);
    for (const bad of ["https://evil.test/cb", "evil://x"]) {
      const p = new URLSearchParams({
        mode: "login",
        client: "mobile",
        code_challenge: pkceChallenge(v),
        redirect_uri: bad,
      });
      expect((await startGet(req(`/api/auth/sso/start?${p}`))).status).toBe(400);
    }
    const ok = new URLSearchParams({
      mode: "login",
      client: "mobile",
      code_challenge: pkceChallenge(v),
      redirect_uri: "exp://192.168.0.2:8081/--/auth/sso",
    });
    expect((await startGet(req(`/api/auth/sso/start?${ok}`))).status).toBe(303);
  });

  it("Web の流れ（/auth/sso/start → 認証サーバー → /auth/sso/complete）でセッションの Cookie が入る", async () => {
    const pwd = (await pwdLogin("me")).token!;
    expect(((await runFlow("link", pwd)) as Response).status).toBe(200);
    as(null);
    const start = await webStart(req("/auth/sso/start?mode=login"));
    expect(start.status).toBe(303);
    const pkce = start.cookies.get("sso_pkce")!.value;
    const s = await startGet(req(start.headers.get("location")!));
    const back = idp.authorize(s.headers.get("location")!);
    const loc = (await callbackGet(req(back))).headers.get("location")!;
    expect(loc.startsWith(`${BASE}/auth/sso/complete?code=`)).toBe(true);
    // Cookie の code_verifier がなければ交換できない
    const noCookie = await webComplete(req(loc));
    expect(noCookie.headers.get("location")).toBe("/login?sso_error=expired");
    const done = await webComplete(req(loc, { cookie: `sso_pkce=${pkce}` }));
    expect(done.headers.get("location")).toBe("/dashboard");
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
    const session = await prisma.session.findFirst({
      where: { userId: ids.me },
      orderBy: { createdAt: "desc" },
    });
    expect(session?.loginMethod).toBe("sso");
  });

  it("鍵が入れ替わった直後でも、知らない kid なら読み直す", async () => {
    const pwd = (await pwdLogin("me")).token!;
    expect(((await runFlow("link", pwd)) as Response).status).toBe(200);
    idp.signer = new Signer("EdDSA", "ed-1");
    const t0 = Date.now();
    oidcIo.now = () => t0 + JWKS_FORCE_REFRESH_MIN_MS + 1000;
    expect(((await runFlow("login")) as Response).status).toBe(200);
    expect(idp.jwksHits).toBe(2);
  });
});
