import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";

// マネーフォワード クラウド会計 API 設定（環境変数から取得）
// MF_CLIENT_ID, MF_CLIENT_SECRET, MF_REDIRECT_URI を .env で設定する
const MF_AUTH_URL = "https://app.moneyforward.com/oauth/authorize";
const MF_TOKEN_URL = "https://app.moneyforward.com/oauth/token";
const MF_API_BASE = "https://invoice.moneyforward.com/api/v3";

// GET /api/integrations/moneyforward?action=auth_url
// OAuth 認可 URL を返す。
//
// GET /api/integrations/moneyforward?action=callback&code=XXX
// OAuth コールバック。認可コードをアクセストークンに交換して返す。
//
// GET /api/integrations/moneyforward?action=journals&accessToken=XXX
// マネーフォワード 仕訳帳データを取得して返す。
export async function GET(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") ?? "auth_url";

  const clientId = process.env.MF_CLIENT_ID;
  const redirectUri =
    process.env.MF_REDIRECT_URI ??
    `${req.nextUrl.origin}/api/integrations/moneyforward?action=callback`;

  if (action === "auth_url") {
    if (!clientId) {
      return NextResponse.json(
        {
          error: "MF_CLIENT_ID が設定されていません。環境変数を設定してください。",
          configured: false,
        },
        { status: 503 },
      );
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "mf_account",
    });
    return NextResponse.json({ authUrl: `${MF_AUTH_URL}?${params}`, configured: true });
  }

  if (action === "callback") {
    const code = sp.get("code");
    const clientSecret = process.env.MF_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) {
      return NextResponse.json({ error: "認可コードまたは設定が不足しています" }, { status: 400 });
    }

    const tokenRes = await fetch(MF_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      return NextResponse.json({ error: "トークン取得に失敗しました" }, { status: 502 });
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    // TODO: DB にトークンを暗号化して保存する
    return NextResponse.json({
      message: "マネーフォワード 連携が完了しました。",
      accessToken: token.access_token,
      expiresIn: token.expires_in,
    });
  }

  if (action === "journals") {
    const accessToken = sp.get("accessToken");
    if (!accessToken) {
      return NextResponse.json({ error: "accessToken が必要です" }, { status: 400 });
    }

    const journalsRes = await fetch(`${MF_API_BASE}/journals`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!journalsRes.ok) {
      return NextResponse.json(
        { error: "マネーフォワード API 呼び出しに失敗しました" },
        { status: 502 },
      );
    }
    const journalsData = (await journalsRes.json()) as { journals: unknown[] };

    return NextResponse.json({
      source: "moneyforward",
      count: journalsData.journals?.length ?? 0,
      journals: journalsData.journals,
      message: "仕訳データを取得しました。",
    });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
