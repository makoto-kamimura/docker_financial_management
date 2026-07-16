import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest } from "@/lib/api-error";

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
export const GET = withApi({
  role: "editor",
  querySchema: z.object({
    action: z.string().default("auth_url"),
    code: z.string().optional(),
    accessToken: z.string().optional(),
  }),
  handler: async ({ req, query }) => {
    const { action } = query;

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
      const clientSecret = process.env.MF_CLIENT_SECRET;
      if (!query.code || !clientId || !clientSecret) {
        throw badRequest("認可コードまたは設定が不足しています");
      }

      const tokenRes = await fetch(MF_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code: query.code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new ApiError(502, "トークン取得に失敗しました");

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
      if (!query.accessToken) throw badRequest("accessToken が必要です");

      const journalsRes = await fetch(`${MF_API_BASE}/journals`, {
        headers: {
          Authorization: `Bearer ${query.accessToken}`,
          Accept: "application/json",
        },
      });
      if (!journalsRes.ok) {
        throw new ApiError(502, "マネーフォワード API 呼び出しに失敗しました");
      }
      const journalsData = (await journalsRes.json()) as { journals: unknown[] };

      return NextResponse.json({
        source: "moneyforward",
        count: journalsData.journals?.length ?? 0,
        journals: journalsData.journals,
        message: "仕訳データを取得しました。",
      });
    }

    throw badRequest(`unknown action: ${action}`);
  },
});
