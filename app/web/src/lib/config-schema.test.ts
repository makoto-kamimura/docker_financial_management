import { describe, expect, it } from "vitest";
import { Env } from "./config-schema";

// NOTE: lib/config.ts の config（Env.parse(process.env) の結果）は import 時点で
// process.env を検証してしまう副作用を持つため、ここではスキーマ（Env）単体を
// 任意の入力で検証する（lib/config-schema.ts への分離理由）。

const BASE_ENV = { DATABASE_URL: "postgresql://app:app@localhost:5432/financial" };

describe("Env スキーマ (S-13)", () => {
  it("最小構成（DATABASE_URL のみ）で既定値が適用される", () => {
    const result = Env.parse(BASE_ENV);
    expect(result.COOKIE_SECURE).toBe("true");
    expect(result.SESSION_IDLE_HOURS).toBe(24);
    expect(result.SESSION_ABSOLUTE_DAYS).toBe(7);
    expect(result.UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(result.CLEANUP_SERVICE_KEY).toBeUndefined();
  });

  it("DATABASE_URL が無い、または URL 形式でなければ拒否する", () => {
    expect(() => Env.parse({})).toThrow();
    expect(() => Env.parse({ DATABASE_URL: "not-a-url" })).toThrow();
  });

  it("CLEANUP_SERVICE_KEY は 32 文字未満を拒否する", () => {
    expect(() => Env.parse({ ...BASE_ENV, CLEANUP_SERVICE_KEY: "short-key" })).toThrow();
    expect(() => Env.parse({ ...BASE_ENV, CLEANUP_SERVICE_KEY: "a".repeat(32) })).not.toThrow();
  });

  it("REDIS_URL / APP_ORIGIN は URL 形式でなければ拒否する", () => {
    expect(() => Env.parse({ ...BASE_ENV, REDIS_URL: "not-a-url" })).toThrow();
    expect(() => Env.parse({ ...BASE_ENV, REDIS_URL: "redis://localhost:6379" })).not.toThrow();
    expect(() => Env.parse({ ...BASE_ENV, APP_ORIGIN: "not-a-url" })).toThrow();
    expect(() => Env.parse({ ...BASE_ENV, APP_ORIGIN: "https://example.com" })).not.toThrow();
  });

  it("COOKIE_SECURE は true/false 以外を拒否する", () => {
    expect(() => Env.parse({ ...BASE_ENV, COOKIE_SECURE: "yes" })).toThrow();
    expect(Env.parse({ ...BASE_ENV, COOKIE_SECURE: "false" }).COOKIE_SECURE).toBe("false");
  });

  it("SESSION_IDLE_HOURS 等の数値は文字列から coerce される", () => {
    const result = Env.parse({ ...BASE_ENV, SESSION_IDLE_HOURS: "48" });
    expect(result.SESSION_IDLE_HOURS).toBe(48);
  });
});
