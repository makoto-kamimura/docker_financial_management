import { NextRequest, NextResponse } from "next/server";
import { startFlow } from "@/lib/server/sso";

// GET /api/auth/sso/start … SSO の開始（公開）。mode・client・code_challenge・モバイルは redirect_uri・連携は intent。
// 認証サーバーの認可画面へ 303 する
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const r = await startFlow({
    mode: q.get("mode"),
    client: q.get("client"),
    codeChallenge: q.get("code_challenge"),
    redirectUri: q.get("redirect_uri"),
    intent: q.get("intent"),
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return new NextResponse(null, { status: 303, headers: { Location: r.url } });
}
