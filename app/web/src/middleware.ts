import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, isMutatingApiRequest } from "@/lib/csrf";
import { sessionCookieName } from "@/lib/session-constants";

// 保護対象パス。未ログイン（セッション Cookie 無し）なら /login へリダイレクトする。
// NOTE: ここでは Cookie の有無のみを確認する軽量チェック。
//       セッションの有効性検証は各 API / Server 側（lib/auth）で行う。
const PROTECTED = [
  "/dashboard",
  "/assets",
  "/entry",
  "/budget",
  "/reports",
  "/bank-transactions",
  "/bank-accounts",
  "/loans",
  "/journals",
  "/journal-templates",
  "/account-conversion",
  "/receivables",
  "/payables",
  "/invoices",
  "/inventories",
  "/fixed-assets",
  "/apportionments",
  "/integrations",
  "/closing",
  "/corporate",
  "/fiscal-years",
  "/governance",
  "/portal",
  "/settings",
  "/admin",
];
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/* の状態変更リクエストは Origin / Sec-Fetch-Site を検証する（CSRF 防御）。
  // Bearer 認証（モバイル）は Cookie を使わないため checkCsrf 内で免除される。
  if (isMutatingApiRequest(pathname, req.method) && !checkCsrf(req)) {
    return NextResponse.json({ error: "forbidden: invalid origin" }, { status: 403 });
  }

  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSession = req.cookies.has(sessionCookieName());
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/assets/:path*",
    "/entry/:path*",
    "/budget/:path*",
    "/reports/:path*",
    "/bank-transactions/:path*",
    "/bank-accounts/:path*",
    "/loans/:path*",
    "/journals/:path*",
    "/journal-templates/:path*",
    "/account-conversion/:path*",
    "/receivables/:path*",
    "/payables/:path*",
    "/invoices/:path*",
    "/inventories/:path*",
    "/fixed-assets/:path*",
    "/apportionments/:path*",
    "/integrations/:path*",
    "/closing/:path*",
    "/corporate/:path*",
    "/fiscal-years/:path*",
    "/governance/:path*",
    "/portal/:path*",
    "/settings/:path*",
    "/admin/:path*",
  ],
};
