import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { exchangeResult } from "@/lib/server/sso";
import { PKCE_COOKIE, SETTINGS_SSO, decodePkce, pkceCookieOptions, redirectTo } from "@/lib/server/sso-web";

function done(location: string) {
  const res = redirectTo(location);
  // code_verifier は 1 回しか使わない
  res.cookies.set(PKCE_COOKIE, "", { ...pkceCookieOptions(), maxAge: 0 });
  return res;
}

function failed(mode: "login" | "link", reason: string) {
  const r = encodeURIComponent(reason);
  return done(mode === "link" ? `${SETTINGS_SSO}&sso_error=${r}` : `/login?sso_error=${r}`);
}

/**
 * 認証サーバーから API を経由して戻ってくる。結果コードと Cookie の code_verifier を交換する。
 * ログインならセッションの Cookie を入れる（このアプリの MFA は求めない。認証サーバーのパスキーが兼ねる）。
 * GET /auth/sso/complete?code=… | ?error=…
 */
export async function GET(req: NextRequest) {
  const pkce = decodePkce(req.cookies.get(PKCE_COOKIE)?.value);
  // Cookie がない = このブラウザで始めた流れではない（または 10 分を過ぎた）
  if (!pkce) return failed("login", "expired");
  const error = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  if (error || !code) return failed(pkce.mode, error ?? "failed");

  let r: Awaited<ReturnType<typeof exchangeResult>>;
  try {
    r = await exchangeResult(code, pkce.verifier, getCurrentUser, req);
  } catch (e) {
    console.warn("sso complete failed:", (e as Error).message);
    return failed(pkce.mode, "failed");
  }
  if (!r.ok) {
    if (pkce.mode === "link" && r.status === 401) return done("/login");
    return failed(pkce.mode, r.status === 409 ? "conflict" : r.status === 400 ? "demo" : "failed");
  }
  if (r.mode === "link") return done(`${SETTINGS_SSO}&sso=linked`);
  return done("/dashboard");
}
