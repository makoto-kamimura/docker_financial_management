import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MOBILE_SHARED_DIR, SHARED_WITH_MOBILE } from "./shared-with-mobile";

const libDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(libDir, MOBILE_SHARED_DIR);

// モバイル版の計算・表示ラベルが Web 版とずれていないこと（仕様の差分を作らないため）
describe("モバイルと共有する lib", () => {
  it.each(SHARED_WITH_MOBILE)("%s はモバイル側の複製と同じ内容", (file) => {
    const web = readFileSync(resolve(libDir, file), "utf8");
    const mobile = readFileSync(resolve(mobileDir, file), "utf8");
    // 差分があれば app/web で `npm run sync:mobile` を実行して複製し直す
    expect(mobile).toBe(web);
  });

  it("共有する lib は @/ の import を使わない（モバイル側で解決できないため）", () => {
    for (const file of SHARED_WITH_MOBILE) {
      const src = readFileSync(resolve(libDir, file), "utf8");
      expect(src, file).not.toMatch(/from "@\//);
    }
  });
});
