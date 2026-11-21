import { NextRequest, NextResponse } from "next/server";
import { handleCallback } from "@/lib/server/sso";

const ERROR_HTML =
  '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">' +
  "<p>ログインの有効期限が切れたか、正しくない要求です。アプリに戻って、もう一度やり直してください。</p>";

// GET /api/auth/sso/callback … 認証サーバーからの戻り（公開）。
// クライアントへ ?code=（使い捨ての結果コード）か ?error=（not_linked / mfa_required / cancelled / expired / failed）で 303
export async function GET(req: NextRequest) {
  try {
    const location = await handleCallback(req.nextUrl.searchParams);
    return new NextResponse(null, { status: 303, headers: { Location: location } });
  } catch (e) {
    console.warn("sso callback rejected:", (e as Error).message);
    return new NextResponse(ERROR_HTML, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
