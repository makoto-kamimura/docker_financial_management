import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit";
import type { NextRequest } from "next/server";

function fakeRequest(xff: string | null): NextRequest {
  return {
    headers: { get: (name: string) => (name === "x-forwarded-for" ? xff : null) },
  } as unknown as NextRequest;
}

describe("clientIp", () => {
  it("x-forwarded-for の先頭値を返す", () => {
    expect(clientIp(fakeRequest("203.0.113.1, 10.0.0.1"))).toBe("203.0.113.1");
  });

  it("前後の空白を除去する", () => {
    expect(clientIp(fakeRequest("  203.0.113.1  , 10.0.0.1"))).toBe("203.0.113.1");
  });

  it("ヘッダーが無い場合は unknown を返す", () => {
    expect(clientIp(fakeRequest(null))).toBe("unknown");
  });
});
