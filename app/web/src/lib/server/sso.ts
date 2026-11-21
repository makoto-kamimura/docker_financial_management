// SSO（OpenID Connect）でのログインの流れ。API の経路（モバイル）と Web の経路（/auth/sso/*）で共通。
//
// 1. （連携のときだけ）createIntent … ログイン中の利用者に、使い捨ての intent を発行
// 2. startFlow    … クライアントが作った code_challenge を受け取り、認証サーバーへ送る URL を返す
// 3. handleCallback … 認証サーバーから戻る。使い捨ての結果コードを付けた戻り先を返す
// 4. exchangeResult … 結果コードと code_verifier を引き換える。ここでログイン / 連携が成立する
//
// 新しい利用者は作らない。SSO で入れるのは、パスワードでログインしたうえで連携した人だけ。
// SSO のログインでは、このアプリの MFA（TOTP）は求めない（認証サーバーのパスキーが 2 段階認証を兼ねる。
// OIDC_REQUIRE_MFA=true のとき、ID トークンの amr に mfa がなければ断る）。
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { createSession } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import {
  LOGIN_SSO,
  PROVIDER,
  Rejected,
  authorizationUrl,
  exchangeCode,
  hashToken,
  isValidChallenge,
  linkDenied,
  mobileRedirectAllowed,
  oidcConfig,
  pkceChallenge,
  randomToken,
  ssoEnabled,
  verifyPkce,
  verifyWithIdp,
  webReturnUrl,
  withQuery,
} from "@/lib/server/oidc";

const FLOW_TTL_MS = 600_000; // 開始から認証サーバーでの操作を終えるまでの猶予
const RESULT_TTL_MS = 60_000; // 結果コードの有効期間

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const DEMO_DENIED = "デモ用のアカウントには SSO を連携できません";

function meta(req?: NextRequest) {
  return {
    ip: req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req?.headers.get("user-agent"),
  };
}

export function providers() {
  const on = ssoEnabled();
  return { sso: on, sso_name: on ? oidcConfig().displayName : null };
}

/** 認証サーバーへ送る URL を作る（連携は intent が要る） */
export async function startFlow(q: {
  mode: string | null;
  client: string | null;
  codeChallenge: string | null;
  redirectUri: string | null;
  intent: string | null;
}): Promise<{ ok: true; url: string } | Fail> {
  if (!ssoEnabled()) return fail(404, "not found");
  if (!isValidChallenge(q.codeChallenge)) return fail(400, "code_challenge が正しくありません");
  let returnTo: string;
  if (q.client === "web") {
    returnTo = webReturnUrl();
  } else if (q.client === "mobile") {
    returnTo = q.redirectUri ?? "";
    if (!mobileRedirectAllowed(returnTo, oidcConfig().mobileRedirectPrefixes)) {
      return fail(400, "redirect_uri が許可されていません");
    }
  } else {
    return fail(400, "client が正しくありません");
  }
  if (q.mode !== "login" && q.mode !== "link") return fail(400, "mode が正しくありません");

  const now = new Date();
  await prisma.oauthFlow.deleteMany({ where: { expiresAt: { lt: now } } });
  const state = randomToken();
  const nonce = randomToken();
  const serverVerifier = randomToken();
  const fields = {
    stateHash: hashToken(state),
    nonce,
    serverVerifier,
    clientChallenge: q.codeChallenge,
    returnTo,
    expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
  };
  if (q.mode === "login") {
    await prisma.oauthFlow.create({ data: { mode: "login", ...fields } });
  } else {
    // intent は 1 回だけ使える。使ったら消して state に進める
    const { count } = await prisma.oauthFlow.updateMany({
      where: { intentHash: hashToken(q.intent ?? ""), mode: "link", expiresAt: { gt: now } },
      data: { ...fields, intentHash: null },
    });
    if (count === 0) return { ok: true, url: withQuery(returnTo, "error", "expired") };
  }
  try {
    return { ok: true, url: await authorizationUrl(state, nonce, pkceChallenge(serverVerifier)) };
  } catch (e) {
    console.error("sso: cannot reach the identity provider:", (e as Error).message);
    return fail(502, "認証サーバーに接続できません");
  }
}

/** 認証サーバーからの戻りを確かめ、クライアントへ戻す URL を返す。戻り先も分からないときは例外 */
export async function handleCallback(q: URLSearchParams): Promise<string> {
  if (!ssoEnabled()) throw new Error("sso is disabled");
  // state は 1 回だけ使える
  const stateHash = hashToken(q.get("state") ?? "");
  const flow = await prisma.$transaction(async (tx) => {
    const f = await tx.oauthFlow.findFirst({ where: { stateHash, expiresAt: { gt: new Date() } } });
    if (!f) return null;
    const { count } = await tx.oauthFlow.updateMany({
      where: { id: f.id, stateHash },
      data: { stateHash: null },
    });
    return count === 1 ? f : null;
  });
  if (!flow?.returnTo) throw new Error("unknown or expired state");

  const result = await finish(flow, q.get("code"), q.has("error"));
  if (typeof result === "string") {
    await prisma.oauthFlow.delete({ where: { id: flow.id } }).catch(() => {});
    return withQuery(flow.returnTo, "error", result);
  }
  const code = randomToken();
  await prisma.oauthFlow.update({
    where: { id: flow.id },
    data: {
      resultHash: hashToken(code),
      resultSubject: result.sub,
      resultEmail: result.email,
      nonce: null,
      serverVerifier: null,
      expiresAt: new Date(Date.now() + RESULT_TTL_MS),
    },
  });
  return withQuery(flow.returnTo, "code", code);
}

/** 認証サーバーから受け取ったものを確かめる。失敗したときはクライアントに返す理由 */
async function finish(
  flow: { mode: string; nonce: string | null; serverVerifier: string | null },
  code: string | null,
  hasError: boolean,
): Promise<{ sub: string; email: string | null } | string> {
  if (hasError) return "cancelled";
  if (!code || !flow.nonce || !flow.serverVerifier) return "failed";
  let idToken: string;
  try {
    idToken = await exchangeCode(code, flow.serverVerifier);
  } catch (e) {
    console.warn("sso token exchange failed:", (e as Error).message);
    return "failed";
  }
  let claims: Record<string, unknown>;
  try {
    claims = await verifyWithIdp(idToken, flow.nonce);
  } catch (e) {
    if (e instanceof Rejected && e.reason === "mfa_required") {
      console.info("sso: login without MFA was rejected");
      return "mfa_required";
    }
    console.warn("sso id_token rejected:", e instanceof Rejected ? e.reason : (e as Error).message);
    return "failed";
  }
  const sub = claims.sub as string;
  if (flow.mode === "login") {
    const linked = await prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: PROVIDER, subject: sub } },
      select: { id: true },
    });
    if (!linked) {
      console.info("sso login: account is not linked");
      return "not_linked";
    }
  }
  return { sub, email: typeof claims.email === "string" ? claims.email : null };
}

type LinkUser = { id: number; email: string; tenantId: number } | null;

/**
 * 結果コードを、開始したクライアントの code_verifier と引き換える。
 * ログインならセッションを作り（Cookie も入れる）、連携なら me（ログイン中の本人）に登録する。
 */
export async function exchangeResult(
  code: string,
  verifier: string,
  me: () => Promise<LinkUser>,
  req?: NextRequest,
): Promise<
  | { ok: true; mode: "login"; sessionId: string; user: { id: number; name: string; role: string } }
  | { ok: true; mode: "link"; email: string | null }
  | Fail
> {
  if (!ssoEnabled()) return fail(404, "not found");
  // 結果コードは 1 回だけ使える。code_verifier が違っても消す（総当たりさせない）
  const resultHash = hashToken((code ?? "").trim());
  const flow = await prisma.$transaction(async (tx) => {
    const f = await tx.oauthFlow.findFirst({
      where: { resultHash, expiresAt: { gt: new Date() } },
    });
    if (!f) return null;
    const { count } = await tx.oauthFlow.deleteMany({ where: { id: f.id, resultHash } });
    return count === 1 ? f : null;
  });
  if (!flow || !flow.resultSubject || !verifyPkce(verifier ?? "", flow.clientChallenge ?? "")) {
    if (flow) console.warn("sso exchange: code_verifier mismatch");
    return fail(401, "unauthorized");
  }
  const subject = flow.resultSubject;
  const m = meta(req);

  if (flow.mode === "login") {
    const identity = await prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: PROVIDER, subject } },
      include: { user: true },
    });
    if (!identity) return fail(401, "unauthorized");
    await prisma.userIdentity.update({
      where: { id: identity.id },
      data: { lastLoginAt: new Date() },
    });
    const user = identity.user;
    const sessionId = await createSession(user.id, req, LOGIN_SSO);
    await writeAudit(user.id, "login", `user:${user.id} method:sso`, {
      tenantId: user.tenantId,
      ...m,
    });
    return {
      ok: true,
      mode: "login",
      sessionId,
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  // 連携: ログイン中の本人と、連携を始めた本人が同じであること
  const user = await me();
  if (!user) return fail(401, "unauthorized");
  if (flow.userId !== user.id) {
    console.warn(`sso link: user mismatch user_id=${user.id}`);
    return fail(403, "この操作の権限がありません");
  }
  if (linkDenied(user.email, oidcConfig().linkDenyDomains)) return fail(400, DEMO_DENIED);
  const owner = await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider: PROVIDER, subject } },
  });
  if (owner && owner.userId !== user.id)
    return fail(409, "この SSO のアカウントは、ほかの利用者に連携されています");
  if (owner) {
    await prisma.userIdentity.update({
      where: { id: owner.id },
      data: { email: flow.resultEmail },
    });
  } else {
    const mine = await prisma.userIdentity.findUnique({
      where: { userId_provider: { userId: user.id, provider: PROVIDER } },
      select: { id: true },
    });
    if (mine) return fail(409, "別の SSO のアカウントと連携済みです。解除してから連携してください");
    try {
      await prisma.userIdentity.create({
        data: { userId: user.id, provider: PROVIDER, subject, email: flow.resultEmail },
      });
    } catch {
      return fail(409, "この SSO のアカウントは、ほかの利用者に連携されています");
    }
  }
  await writeAudit(user.id, "sso_linked", `user:${user.id}`, { tenantId: user.tenantId, ...m });
  return { ok: true, mode: "link", email: flow.resultEmail };
}

/** 連携を始める。ブラウザの遷移では Bearer を送れないので、使い捨ての intent を渡す */
export async function createIntent(user: {
  id: number;
  email: string;
}): Promise<{ ok: true; intent: string } | Fail> {
  if (!ssoEnabled()) return fail(404, "not found");
  if (linkDenied(user.email, oidcConfig().linkDenyDomains)) return fail(400, DEMO_DENIED);
  const intent = randomToken();
  await prisma.oauthFlow.create({
    data: {
      mode: "link",
      userId: user.id,
      intentHash: hashToken(intent),
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    },
  });
  return { ok: true, intent };
}

/** 自分の連携の一覧と、SSO が使えるか */
export async function identities(
  user: { id: number; email: string; ssoOnly: boolean },
  loginMethod: string,
) {
  const on = ssoEnabled();
  const rows = await prisma.userIdentity.findMany({
    where: { userId: user.id },
    orderBy: { provider: "asc" },
    select: { provider: true, email: true, createdAt: true, lastLoginAt: true },
  });
  return {
    sso_enabled: on,
    sso_name: on ? oidcConfig().displayName : null,
    can_link: on && !linkDenied(user.email, oidcConfig().linkDenyDomains),
    identities: rows.map((r) => ({
      provider: r.provider,
      email: r.email,
      created_at: r.createdAt,
      last_login_at: r.lastLoginAt,
    })),
    sso_only: user.ssoOnly,
    login_method: loginMethod,
  };
}

/** SSO の連携を解除する。「SSO だけ」も外す（連携がなければ SSO では入れないため） */
export async function unlink(user: { id: number; tenantId: number }, req?: NextRequest) {
  const [{ count }] = await prisma.$transaction([
    prisma.userIdentity.deleteMany({ where: { userId: user.id, provider: PROVIDER } }),
    prisma.user.update({ where: { id: user.id }, data: { ssoOnly: false } }),
  ]);
  if (count > 0)
    await writeAudit(user.id, "sso_unlinked", `user:${user.id}`, {
      tenantId: user.tenantId,
      ...meta(req),
    });
  return { unlinked: count > 0 };
}

/**
 * 「SSO だけでログインする」を切り替える。オンにできるのは、連携していて、いま SSO でログインしている人だけ。
 * オンにすると、パスワードで入っていたほかの端末のログインもその時点で切れる（getCurrentUser が確かめる）
 */
export async function setSsoOnly(
  user: { id: number; tenantId: number },
  loginMethod: string,
  enabled: boolean,
  req?: NextRequest,
): Promise<{ ok: true; sso_only: boolean } | Fail> {
  if (!ssoEnabled()) return fail(404, "not found");
  if (enabled) {
    const linked = await prisma.userIdentity.findUnique({
      where: { userId_provider: { userId: user.id, provider: PROVIDER } },
      select: { id: true },
    });
    if (!linked) return fail(400, "先に SSO のアカウントを連携してください");
    if (loginMethod !== LOGIN_SSO) {
      return fail(
        400,
        "SSO でログインし直してから有効にしてください（SSO で入れることを確かめるため）",
      );
    }
  }
  await prisma.user.update({ where: { id: user.id }, data: { ssoOnly: enabled } });
  await writeAudit(user.id, "sso_only_changed", `user:${user.id} enabled:${enabled}`, {
    tenantId: user.tenantId,
    ...meta(req),
  });
  return { ok: true, sso_only: enabled };
}
