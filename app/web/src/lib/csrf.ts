// CSRF 防御（Origin / Sec-Fetch-Site 検証）。middleware.ts から呼ばれる。
// Edge ランタイムで動くため Node 依存（crypto 等）は使わない。
//
// 対象は Cookie 認証のブラウザリクエストのみ。Authorization: Bearer 認証
// （モバイルアプリ）は Cookie を送らないため CSRF が成立せず、常に免除する。

import { sessionCookieName } from "@/lib/session-constants";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingApiRequest(pathname: string, method: string): boolean {
  return pathname.startsWith("/api/") && MUTATING_METHODS.has(method);
}

// true = リクエストを通してよい、false = CSRF 疑いで拒否（403）
export function checkCsrf(req: { headers: Headers; nextUrl: { origin: string } }): boolean {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return true; // モバイル: Cookie を使わないため対象外

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  const origin = req.headers.get("origin");
  if (origin) {
    const expected = process.env.APP_ORIGIN || req.nextUrl.origin;
    return origin === expected;
  }

  // Sec-Fetch-Site も Origin も無い（古いブラウザ・curl・モバイルアプリの
  // ログイン前リクエスト等）。セッション Cookie を持つリクエストは既存
  // セッションが CSRF で悪用され得るためフェイルクローズで拒否するが、
  // Cookie を持たないリクエスト（ログイン等、悪用できるセッションが無い）は通す。
  const hasSessionCookie = req.headers.get("cookie")?.includes(`${sessionCookieName()}=`) ?? false;
  return !hasSessionCookie;
}
