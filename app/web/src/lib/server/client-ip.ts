import { isIP } from "node:net";
import { getConfig } from "@/lib/server/config";

// リクエストの接続元の IP を決める（レート制限のキー・セッション・監査ログで共通）。
//
// 前段のリバースプロキシは、受け取った X-Forwarded-For の右に、自分が見た接続元を足す。
// 左側の値はクライアントが自由に送れるので、使わない。信頼するプロキシの段数
// （TRUSTED_PROXY_HOPS、既定 1）だけ右から数えた値を使う。
//   例: 段数 1・"偽, 203.0.113.1" → 203.0.113.1（右端）
//       段数 2（CDN → nginx → アプリ）・"偽, 203.0.113.1, <CDN>" → 203.0.113.1
// 段数より値が少ないときは左端を使う。
// X-Forwarded-For が無いとき（Next.js のサーバーは、無ければ直接の接続元を入れるので、ふつうは無いことはない）
// だけ、X-Real-IP を使う。X-Real-IP を先に見ないのは、それを上書きしないプロキシ
// （X-Forwarded-For だけを足すもの）の後ろでは、クライアントが送った値がそのまま届くため。
//
// Edge ランタイム（middleware.ts）からは import しないこと（node:net と getConfig を使う）。

type HeaderSource = { headers: { get(name: string): string | null } };

const MAX_IP_LENGTH = 64;

function normalize(value: string | undefined | null): string | undefined {
  let ip = value?.trim();
  if (!ip || ip.length > MAX_IP_LENGTH) return undefined;
  // [IPv6]:port と IPv4:port を外す（ポートを付けて足すプロキシがある）
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  return isIP(ip) ? ip.toLowerCase() : undefined;
}

const trustedProxyHops = (): number => getConfig().TRUSTED_PROXY_HOPS;

/** 接続元の IP。分からなければ undefined（セッション・監査ログでは空にする） */
export function requestIp(req: HeaderSource | undefined, hops?: number): string | undefined {
  if (!req) return undefined;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const list = xff.split(",");
    return normalize(list[Math.max(0, list.length - (hops ?? trustedProxyHops()))]);
  }
  return normalize(req.headers.get("x-real-ip"));
}

/** 接続元の IP。分からなければ "unknown"（レート制限のキーに使う） */
export function clientIp(req: HeaderSource, hops?: number): string {
  return requestIp(req, hops) ?? "unknown";
}
