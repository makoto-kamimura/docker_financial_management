// SSO の Web 側（/auth/sso/start・/auth/sso/complete）で、code_verifier（PKCE）を持っておく Cookie。
// 戻ってきた結果コードは、この値がないと交換できない（他人に URL を踏ませても成立しない）。
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isCookieSecure } from "@/lib/server/session-constants";

export const PKCE_COOKIE = "sso_pkce";
export type SsoMode = "login" | "link";

export const pkceCookieOptions = () =>
  ({
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "lax",
    // 認証サーバーから戻るのは /auth/sso/complete なので、そこでだけ送る
    path: "/auth/sso",
    maxAge: 10 * 60,
  }) as const;

export const createVerifier = () => randomBytes(32).toString("base64url");

/** Cookie の値は「mode.verifier」 */
export const encodePkce = (mode: SsoMode, verifier: string) => `${mode}.${verifier}`;

export function decodePkce(value: string | undefined): { mode: SsoMode; verifier: string } | null {
  if (!value) return null;
  const [mode, verifier] = value.split(".", 2);
  if ((mode !== "login" && mode !== "link") || !verifier) return null;
  return { mode, verifier };
}

// リバースプロキシ配下なので、絶対 URL を組まずに相対の Location で返す
export const redirectTo = (location: string) =>
  new NextResponse(null, { status: 303, headers: { Location: location } });

export const SETTINGS_SSO = "/settings?tab=security";
