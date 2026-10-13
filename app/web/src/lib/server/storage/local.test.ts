import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localStorage } from "./local";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uploads-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("localStorage", () => {
  it("テナントのフォルダに保存し、読み出し、消せる", async () => {
    const s = localStorage(dir);
    await s.put(7, "a.jpg", Buffer.from("abc"), "image/jpeg");
    expect(existsSync(path.join(dir, "7", "a.jpg"))).toBe(true);
    expect((await s.get(7, "a.jpg"))?.toString()).toBe("abc");

    await s.remove(7, "a.jpg");
    expect(await s.get(7, "a.jpg")).toBeNull();
  });

  it("旧構成の平置きのファイルも読み出し、消せる", async () => {
    await writeFile(path.join(dir, "old.pdf"), "%PDF-");
    const s = localStorage(dir);
    expect((await s.get(7, "old.pdf"))?.toString()).toBe("%PDF-");
    await s.remove(7, "old.pdf");
    expect(existsSync(path.join(dir, "old.pdf"))).toBe(false);
  });

  it("無いファイルは null。消してもエラーにしない", async () => {
    await mkdir(path.join(dir, "7"));
    const s = localStorage(dir);
    expect(await s.get(7, "none.jpg")).toBeNull();
    await expect(s.remove(7, "none.jpg")).resolves.toBeUndefined();
  });
});
