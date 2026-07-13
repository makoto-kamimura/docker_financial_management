import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest } from "@/lib/api-error";

// freee API OAuth 2.0 設定（環境変数から取得）
// FREEE_CLIENT_ID, FREEE_CLIENT_SECRET, FREEE_REDIRECT_URI を .env で設定する
const FREEE_AUTH_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const FREEE_TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
const FREEE_API_BASE = "https://api.freee.co.jp";

// GET /api/integrations/freee?action=auth_url
// OAuth 認可 URL を返す。フロントがこの URL にリダイレクトして認可フローを開始する。
//
// GET /api/integrations/freee?action=callback&code=XXX
// OAuth コールバック。認可コードをアクセストークンに交換して返す。
// 本番運用では access_token / refresh_token を DB (encrypted) に保存する。
//
// GET /api/integrations/freee?action=deals&accessToken=XXX&companyId=XXX
// freee 取引一覧（deals）を取得して財務記録形式に変換して返す。
export const GET = withApi({
  role: "editor",
  querySchema: z.object({
    action: z.string().default("auth_url"),
    code: z.string().optional(),
    accessToken: z.string().optional(),
    companyId: z.string().optional(),
  }),
  handler: async ({ req, query }) => {
    const { action } = query;

    const clientId = process.env.FREEE_CLIENT_ID;
    const redirectUri =
      process.env.FREEE_REDIRECT_URI ??
      `${req.nextUrl.origin}/api/integrations/freee?action=callback`;

    if (action === "auth_url") {
      if (!clientId) {
        return NextResponse.json(
          {
            error: "FREEE_CLIENT_ID が設定されていません。環境変数を設定してください。",
            configured: false,
          },
          { status: 503 },
        );
      }
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read write",
      });
      return NextResponse.json({ authUrl: `${FREEE_AUTH_URL}?${params}`, configured: true });
    }

    if (action === "callback") {
      const clientSecret = process.env.FREEE_CLIENT_SECRET;
      if (!query.code || !clientId || !clientSecret) {
        throw badRequest("認可コードまたは設定が不足しています");
      }

      const tokenRes = await fetch(FREEE_TOKEN_URL, {
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
        message: "freee 連携が完了しました。",
        accessToken: token.access_token,
        expiresIn: token.expires_in,
      });
    }

    if (action === "deals") {
      const { accessToken, companyId } = query;
      if (!accessToken || !companyId) throw badRequest("accessToken と companyId が必要です");

      const dealsRes = await fetch(
        `${FREEE_API_BASE}/api/1/deals?company_id=${companyId}&limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!dealsRes.ok) throw new ApiError(502, "freee API 呼び出しに失敗しました");

      const dealsData = (await dealsRes.json()) as { deals: unknown[] };

      // freee 取引 → 財務記録形式に変換（実際の変換ロジックはフィールドマッピングが必要）
      return NextResponse.json({
        source: "freee",
        count: dealsData.deals.length,
        deals: dealsData.deals,
        message:
          "取引データを取得しました。インポートするには POST /api/financials/import を使用してください。",
      });
    }

    throw badRequest(`unknown action: ${action}`);
  },
});
