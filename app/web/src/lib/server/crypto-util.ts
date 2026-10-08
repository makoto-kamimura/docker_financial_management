import { timingSafeEqual } from "node:crypto";

// S-13: 定数時間比較。サービスキー認証などの秘密情報比較に使う。
// 長さが異なる場合、Buffer.byteLength での早期リターンだけだとタイミング差が出るため、
// 同じ長さのダミー比較を必ず行ってから false を返す。
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
