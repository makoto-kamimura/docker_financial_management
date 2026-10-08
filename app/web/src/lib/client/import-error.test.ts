import { describe, expect, it } from "vitest";
import { importErrorMessage } from "./import-error";

function res(status: number, body?: string, contentType = "application/json"): Response {
  return new Response(body ?? null, { status, headers: { "content-type": contentType } });
}

describe("importErrorMessage", () => {
  it("API が返した error をそのまま使う", async () => {
    const msg = await importErrorMessage(res(400, JSON.stringify({ error: "empty body" })));
    expect(msg).toBe("empty body");
  });

  it("WAF の HTML 403 では JSON パース失敗を握り潰さずステータスを示す", async () => {
    const msg = await importErrorMessage(res(403, "<html>403 Forbidden</html>", "text/html"));
    expect(msg).toContain("403");
    expect(msg).toContain("WAF");
  });

  it("未知のステータスは HTTP コード付きの汎用メッセージ", async () => {
    const msg = await importErrorMessage(res(502, "<html>bad gateway</html>", "text/html"));
    expect(msg).toContain("HTTP 502");
  });
});
