// セッション Cookie 名・トークン形式に関する定数。Edge ランタイム（middleware.ts）
// からも import されるため Node 依存（crypto 等）は置かない。

// 新形式トークンの接頭辞。`sha256(token)` を DB に保存する対象を旧形式（平文 ID）と判別する。
export const SESSION_TOKEN_PREFIX = "fm2:";

export function isCookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
}

// `__Host-` プレフィックスは Secure 属性必須のため、非 Secure な開発環境では
// 従来名にフォールバックする（フォールバックしないと Cookie が保存されない）。
export function sessionCookieName(): string {
  return isCookieSecure() ? "__Host-fm_session" : "fm_session";
}
