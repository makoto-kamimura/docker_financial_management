import { beforeAll, describe, expect, it, vi } from "vitest";

// Redis にはつながない（isReady が false のクライアント）。ログインの回数制限はメモリで数える
vi.mock("redis", () => ({
  createClient: () => ({ isReady: false, on: () => {}, connect: () => Promise.resolve() }),
}));

import { clientIp, requestIp } from "./client-ip";
import { checkRateLimit } from "./rate-limit";

function fakeRequest(headers: Record<string, string | null>) {
  return { headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } };
}
const xff = (value: string | null) => fakeRequest({ "x-forwarded-for": value });

describe("clientIp", () => {
  beforeAll(() => {
    // 段数の既定値（TRUSTED_PROXY_HOPS 未設定 → 1）を getConfig() から読む
    vi.stubEnv("DATABASE_URL", "postgresql://app:app@localhost:5432/financial");
  });

  it("x-forwarded-for の右端（前段のプロキシが足した値）を使う", () => {
    expect(clientIp(xff("198.51.100.7, 203.0.113.1"))).toBe("203.0.113.1");
    expect(clientIp(xff("203.0.113.1"))).toBe("203.0.113.1");
  });

  it("左端に偽の値を入れても、回数制限のキーは変わらない", () => {
    const keys = new Set(
      ["1.1.1.1", "2.2.2.2, 3.3.3.3", "unknown", "", "::1"].map(
        (leftmost) => `rl:login:ip:${clientIp(xff(`${leftmost}, 203.0.113.1`))}`,
      ),
    );
    expect([...keys]).toEqual(["rl:login:ip:203.0.113.1"]);
  });

  it("左端の値が変わっても、ログインの回数制限（10 回 / 5 分）は同じ接続元として数える", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) {
      const ip = clientIp(xff(`10.0.0.${i}, 203.0.113.99`));
      results.push(
        (await checkRateLimit(`rl:login:ip:${ip}`, 10, 300, { useMemoryFallback: true })).allowed,
      );
    }
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });

  it("信頼するプロキシが 2 段なら、右から 2 番目を使う", () => {
    expect(clientIp(xff("1.1.1.1, 203.0.113.1, 192.0.2.10"), 2)).toBe("203.0.113.1");
    // 値が段数より少ないときは左端
    expect(clientIp(xff("203.0.113.1"), 2)).toBe("203.0.113.1");
  });

  it("x-forwarded-for があれば、x-real-ip は見ない", () => {
    const req = fakeRequest({ "x-forwarded-for": "203.0.113.1", "x-real-ip": "1.1.1.1" });
    expect(clientIp(req)).toBe("203.0.113.1");
  });

  it("x-forwarded-for が無ければ x-real-ip を使う", () => {
    expect(clientIp(fakeRequest({ "x-real-ip": " 203.0.113.1 " }))).toBe("203.0.113.1");
  });

  it("前後の空白とポートを外し、IPv6 も扱う", () => {
    expect(clientIp(xff("1.1.1.1,   203.0.113.1  "))).toBe("203.0.113.1");
    expect(clientIp(xff("203.0.113.1:51234"))).toBe("203.0.113.1");
    expect(clientIp(xff("[2001:DB8::1]:443"))).toBe("2001:db8::1");
    expect(clientIp(xff("2001:db8::1"))).toBe("2001:db8::1");
  });

  it("IP の形でない値・ヘッダーが無いときは unknown（セッションと監査ログでは undefined）", () => {
    expect(clientIp(xff(null))).toBe("unknown");
    expect(clientIp(xff("1.1.1.1, not-an-ip"))).toBe("unknown");
    expect(clientIp(xff(`1.1.1.1, ${"9".repeat(100)}`))).toBe("unknown");
    expect(requestIp(xff(null))).toBeUndefined();
    expect(requestIp(undefined)).toBeUndefined();
  });
});
