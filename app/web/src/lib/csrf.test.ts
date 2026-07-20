import { describe, it, expect } from "vitest";
import { checkCsrf, isMutatingApiRequest } from "./csrf";

function makeReq(headers: Record<string, string>, origin = "http://localhost:3000") {
  return {
    headers: new Headers(headers),
    nextUrl: { origin },
  };
}

describe("isMutatingApiRequest", () => {
  it("/api/* への POST/PUT/PATCH/DELETE を対象とする", () => {
    expect(isMutatingApiRequest("/api/budgets", "POST")).toBe(true);
    expect(isMutatingApiRequest("/api/budgets/1", "PATCH")).toBe(true);
    expect(isMutatingApiRequest("/api/budgets/1", "PUT")).toBe(true);
    expect(isMutatingApiRequest("/api/budgets/1", "DELETE")).toBe(true);
  });

  it("GET やページ遷移は対象外", () => {
    expect(isMutatingApiRequest("/api/budgets", "GET")).toBe(false);
    expect(isMutatingApiRequest("/dashboard", "POST")).toBe(false);
  });
});

describe("checkCsrf", () => {
  it("Bearer 認証（モバイル）は常に通過する", () => {
    const req = makeReq({ authorization: "Bearer abc123", origin: "http://evil.example" });
    expect(checkCsrf(req)).toBe(true);
  });

  it("Sec-Fetch-Site: same-origin / none は通過する", () => {
    expect(checkCsrf(makeReq({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(checkCsrf(makeReq({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("Sec-Fetch-Site: cross-site 等は拒否する", () => {
    expect(checkCsrf(makeReq({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(checkCsrf(makeReq({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("Sec-Fetch-Site が無い場合は Origin で判定する", () => {
    expect(checkCsrf(makeReq({ origin: "http://localhost:3000" }, "http://localhost:3000"))).toBe(
      true,
    );
    expect(checkCsrf(makeReq({ origin: "http://evil.example" }, "http://localhost:3000"))).toBe(
      false,
    );
  });

  it("APP_ORIGIN 環境変数が設定されていればそちらを期待値にする", () => {
    const prev = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://app.example.com";
    try {
      expect(
        checkCsrf(makeReq({ origin: "https://app.example.com" }, "http://localhost:3000")),
      ).toBe(true);
      expect(checkCsrf(makeReq({ origin: "http://localhost:3000" }, "http://localhost:3000"))).toBe(
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = prev;
    }
  });

  it("Sec-Fetch-Site も Origin も無くセッション Cookie も無い場合は通過する（モバイルのログイン前リクエスト等）", () => {
    expect(checkCsrf(makeReq({}))).toBe(true);
  });

  it("Sec-Fetch-Site も Origin も無いがセッション Cookie がある場合はフェイルクローズで拒否する", () => {
    expect(checkCsrf(makeReq({ cookie: "fm_session=abc123" }))).toBe(false);
    expect(checkCsrf(makeReq({ cookie: "__Host-fm_session=abc123" }))).toBe(false);
  });
});
