import { NextRequest, NextResponse } from "next/server";

// 保護対象パス。未ログイン（セッション Cookie 無し）なら /login へリダイレクトする。
// NOTE: ここでは Cookie の有無のみを確認する軽量チェック。
//       セッションの有効性検証は各 API / Server 側（lib/auth）で行う。
const PROTECTED = ["/dashboard", "/entry", "/masters", "/reports"];
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
  matcher: ["/dashboard/:path*", "/entry/:path*", "/masters/:path*", "/reports/:path*"],
};
