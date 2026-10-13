import { describe, expect, it } from "vitest";
import { r2Settings } from "./index";

const base = { UPLOAD_STORAGE: "r2" as const };

describe("r2Settings", () => {
  it("足りない変数の名前を挙げて例外にする", () => {
    expect(() => r2Settings({ ...base, R2_BUCKET: "b" })).toThrow(
      "R2 を使うには R2_ACCESS_KEY_ID・R2_SECRET_ACCESS_KEY・R2_ACCOUNT_ID または R2_ENDPOINT の設定が要ります",
    );
  });

  it("アカウント ID かエンドポイントのどちらかがあればよい", () => {
    const keys = { R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };
    expect(r2Settings({ ...base, ...keys, R2_ACCOUNT_ID: "acc" })).toMatchObject({
      accountId: "acc",
      bucket: "b",
    });
    expect(r2Settings({ ...base, ...keys, R2_ENDPOINT: "http://127.0.0.1:9000" })).toMatchObject({
      endpoint: "http://127.0.0.1:9000",
    });
  });
});
