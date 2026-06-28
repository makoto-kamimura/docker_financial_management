import path from "node:path";
import { chromium } from "@playwright/test";

// 1920×1080 でダッシュボードの実機スクリーンショットを撮影し docs/images/dashboard.png へ保存する。
// 事前にアプリ起動 + DB(migrate/seed) が必要（docs/operation.md 参照）。
// 既存サーバーを使う場合は E2E_BASE_URL を指定する。
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// npm script は app/web で実行される想定 → リポジトリルートの docs/images へ
const OUT = path.resolve(process.cwd(), "../../docs/images/dashboard.png");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("メールアドレス").fill("admin@example.com");
  await page.getByLabel("パスワード").fill("password");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForTimeout(1200); // グラフ描画の待機

  await page.screenshot({ path: OUT });
  await browser.close();
  console.log("Saved screenshot:", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
