import { NextRequest, NextResponse } from "next/server";

// 保護対象パス。未ログイン（セッション Cookie 無し）なら /login へリダイレクトする。
// NOTE: ここでは Cookie の有無のみを確認する軽量チェック。
//       セッションの有効性検証は各 API / Server 側（lib/auth）で行う。
const PROTECTED = ["/dashboard", "/assets", "/entry", "/budget", "/reports", "/bank-transactions", "/bank-accounts", "/loans", "/journals", "/journal-templates", "/receivables", "/payables", "/invoices", "/inventories", "/fixed-assets", "/apportionments", "/integrations", "/closing", "/corporate", "/fiscal-years", "/governance", "/portal", "/settings", "/admin"];
const SESSION_COOKIE = "fm_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
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
