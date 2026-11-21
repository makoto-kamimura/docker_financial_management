import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { pkceChallenge } from "@/lib/server/oidc";
import { createIntent } from "@/lib/server/sso";
import {
  PKCE_COOKIE,
  SETTINGS_SSO,
  createVerifier,
  encodePkce,
  pkceCookieOptions,
  redirectTo,
} from "@/lib/server/sso-web";

/**
 * SSO でのログイン / 連携を始める。code_verifier を作って Cookie に持ち、API の開始 URL へ送る。
 * GET /auth/sso/start?mode=login | link
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "link" ? "link" : "login";
  const verifier = createVerifier();
  const params = new URLSearchParams({
    mode,
    client: "web",
    code_challenge: pkceChallenge(verifier),
  });

  if (mode === "link") {
    // 連携はログイン中の本人だけ
    const user = await getCurrentUser();
    if (!user) return redirectTo("/login");
    const r = await createIntent(user);
    if (!r.ok)
      return redirectTo(`${SETTINGS_SSO}&sso_error=${r.status === 400 ? "demo" : "failed"}`);
    params.set("intent", r.intent);
  }

  const res = redirectTo(`/api/auth/sso/start?${params}`);
  res.cookies.set(PKCE_COOKIE, encodePkce(mode, verifier), pkceCookieOptions());
  return res;
}
