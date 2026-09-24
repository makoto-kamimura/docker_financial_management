// Web の lib（正本）をモバイル（app/mobile/src/shared/）へ複製する。
// 対象は src/lib/shared-with-mobile.ts の SHARED_WITH_MOBILE。
// 使い方: app/web で `npm run sync:mobile`
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_SHARED_DIR, SHARED_WITH_MOBILE } from "../src/lib/shared-with-mobile";

const libDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib");
const mobileDir = resolve(libDir, MOBILE_SHARED_DIR);

mkdirSync(mobileDir, { recursive: true });
for (const file of SHARED_WITH_MOBILE) {
  copyFileSync(resolve(libDir, file), resolve(mobileDir, file));
  console.log(`copied ${file}`);
}
// 一覧から外したファイルは複製先からも消す（古い複製が残ってずれるのを防ぐ）
const shared = new Set<string>(SHARED_WITH_MOBILE);
for (const file of readdirSync(mobileDir)) {
  const path = resolve(mobileDir, file);
  if (!shared.has(file) && existsSync(path)) {
    rmSync(path);
    console.log(`removed ${file}`);
  }
}
