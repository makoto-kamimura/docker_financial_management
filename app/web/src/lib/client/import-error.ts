// CSV 取込レスポンスからユーザー向けエラーメッセージを組み立てる（クライアント専用）。
//
// 前段の nginx / ModSecurity(OWASP CRS) が弾いた場合、レスポンスは JSON ではなく
// HTML の 403 ページになる。res.json() のパース失敗を「送信中にエラー」で潰すと
// 原因が追えなくなるため、HTTP ステータスを明示したメッセージにフォールバックする。

const FALLBACK = "ファイルの送信中にエラーが発生しました。";

export async function importErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body?.error) return body.error;

  switch (res.status) {
    case 401:
      return "セッションの有効期限が切れています。再ログインしてください。(HTTP 401)";
    case 403:
      return "セキュリティフィルタ (WAF) にブロックされました。(HTTP 403) CSV の内容が検査ルールに一致した可能性があります。管理者にお問い合わせください。";
    case 413:
      return "ファイルサイズが上限を超えています。分割して取込してください。(HTTP 413)";
    case 429:
      return "取込回数の上限に達しました。しばらく待ってから再試行してください。(HTTP 429)";
    default:
      return `${FALLBACK} (HTTP ${res.status})`;
  }
}

// fetch 自体が失敗した（ネットワーク断・CORS 等）ときのメッセージ。
export const importNetworkErrorMessage = FALLBACK;
