// SSO（共通の認証サーバー）。アプリ内のブラウザで API の開始 URL を開き、認証サーバーでログインしたあと、
// ディープリンクで戻ってくる（Expo Go では exp://…/--/auth/sso、ビルド版では kakei://auth/sso）。
// 戻り URL の結果コードは、ここで作った code_verifier（PKCE）がないと交換できない。
// SSO のログインでは、このアプリの MFA（TOTP）は求めない（認証サーバーのパスキーが兼ねる）。
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createSsoIntent, exchangeSso, ssoStartUrl, type UserInfo } from "./api";
import { ssoErrorMessage, type SsoMode } from "./shared/sso-copy";

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let j = 0; j < chars; j++) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

async function challengeOf(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 認証サーバーの画面を開く。利用者が閉じたときは null。ログインならユーザー、連携なら true */
export async function signInWithSso(mode: SsoMode, name: string): Promise<UserInfo | true | null> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const redirectUri = Linking.createURL("auth/sso");
  const params = new URLSearchParams({
    mode,
    client: "mobile",
    code_challenge: await challengeOf(verifier),
    redirect_uri: redirectUri,
  });
  // 連携はログイン中の本人だけ。ブラウザには Bearer を渡せないので、先に intent を取る
  if (mode === "link") params.set("intent", (await createSsoIntent()).intent);

  const result = await WebBrowser.openAuthSessionAsync(ssoStartUrl(params), redirectUri);
  if (result.type !== "success") return null;
  const { queryParams } = Linking.parse(result.url);
  const fail = (reason: string) => new Error(ssoErrorMessage(reason, mode, name) ?? reason);
  if (queryParams?.error) throw fail(String(queryParams.error));
  const code = queryParams?.code;
  if (!code) throw fail("failed");

  const r = await exchangeSso(String(code), verifier);
  if (!r.ok) throw fail(r.status === 409 ? "conflict" : r.status === 400 ? "demo" : "failed");
  if (mode === "link") return true;
  if (!r.user) throw fail("failed");
  return r.user;
}
