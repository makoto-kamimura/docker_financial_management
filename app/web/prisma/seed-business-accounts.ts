/**
 * F003: 個人事業主向け初期勘定科目 seed
 * 既存データは変更せず upsert のみ実行する。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ACCOUNTS = [
  // ── 収入 ──────────────────────────────────────────
  { code: "4000", name: "売上高", category: "REVENUE" },
  { code: "4100", name: "現金売上", category: "REVENUE" },
  { code: "4200", name: "クレジット売上", category: "REVENUE" },
  { code: "4300", name: "QR決済売上", category: "REVENUE" },
  { code: "4400", name: "売掛売上", category: "REVENUE" },
  // ── 仕入・変動費 ──────────────────────────────────
  { code: "5000", name: "仕入高", category: "COGS" },
  // ── 経費（EXPENSE）────────────────────────────────
  { code: "7000", name: "通信費", category: "EXPENSE" },
  { code: "7100", name: "消耗品費", category: "EXPENSE" },
  { code: "7200", name: "水道光熱費", category: "EXPENSE" },
  { code: "7300", name: "車両費", category: "EXPENSE" },
  { code: "7400", name: "会議費", category: "EXPENSE" },
  { code: "7500", name: "地代家賃", category: "EXPENSE" },
  { code: "7600", name: "減価償却費", category: "EXPENSE" },
  { code: "7700", name: "給与賃金", category: "EXPENSE" },
  { code: "7800", name: "福利厚生費", category: "EXPENSE" },
  { code: "7900", name: "広告宣伝費", category: "EXPENSE" },
  { code: "8000", name: "接待交際費", category: "EXPENSE" },
  { code: "8100", name: "損害保険料", category: "EXPENSE" },
  { code: "8200", name: "租税公課", category: "EXPENSE" },
  { code: "8300", name: "雑費", category: "EXPENSE" },
  // ── 流動資産 ──────────────────────────────────────
  { code: "1000", name: "現金", category: "ASSET" },
  { code: "1100", name: "普通預金", category: "ASSET" },
  { code: "1200", name: "当座預金", category: "ASSET" },
  { code: "1300", name: "売掛金", category: "ASSET" },
  { code: "1400", name: "棚卸資産", category: "ASSET" },
  { code: "1500", name: "前払費用", category: "ASSET" },
  { code: "1600", name: "未収収益", category: "ASSET" },
  // ── 固定資産 ──────────────────────────────────────
  { code: "2000", name: "工具器具備品", category: "ASSET" },
  { code: "2100", name: "車両運搬具", category: "ASSET" },
  { code: "2200", name: "建物", category: "ASSET" },
  { code: "2300", name: "土地", category: "ASSET" },
  // ── 負債 ──────────────────────────────────────────
  { code: "3000", name: "買掛金", category: "LIABILITY" },
  { code: "3100", name: "未払金", category: "LIABILITY" },
  { code: "3200", name: "未払費用", category: "LIABILITY" },
  { code: "3300", name: "前受収益", category: "LIABILITY" },
  { code: "3400", name: "借入金", category: "LIABILITY" },
  { code: "3500", name: "未払消費税", category: "LIABILITY" },
] as const;

async function main() {
  console.log("🌱 F003: 個人事業主向け初期勘定科目 seed 開始...");
  const tid = 1; // 管理者テナント（seed.ts の adminTenant）
  let added = 0;
  for (const acc of ACCOUNTS) {
    const result = await prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: acc.code } },
      update: { name: acc.name, category: acc.category },
      create: { tenantId: tid, code: acc.code, name: acc.name, category: acc.category as never },
    });
    if (result) added++;
  }
  console.log(`✅ ${added} 件の勘定科目を upsert しました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
