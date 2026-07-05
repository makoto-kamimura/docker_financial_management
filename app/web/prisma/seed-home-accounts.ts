/**
 * 家庭モード 勘定科目 seed（デモテナント用）
 * 実データは src/lib/default-accounts.ts の HOME_ACCOUNTS_SEED を参照。
 * 新規テナントには API 側（POST /api/admin/users の newTenant / POST /api/tenants）で
 * 自動登録される。このスクリプトはデモテナント（id=1）への投入・再投入用。
 */
import { PrismaClient } from "@prisma/client";
import { ACCOUNT_DISPLAY_NAMES } from "./account-display-names";
import { HOME_ACCOUNTS_SEED } from "../src/lib/default-accounts";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 家庭モード勘定科目 seed 開始...");
  const tid = 1; // デモテナント（seed.ts の demoTenant）
  let upserted = 0;
  for (const acc of HOME_ACCOUNTS_SEED) {
    // 個人事業主・法人モードの表示名を account-master-mapping.md 由来のマスタから設定。
    // 未定義（経過勘定など）は家庭科目名にフォールバックする。
    const names = ACCOUNT_DISPLAY_NAMES[acc.code];
    const soleName = names?.sole ?? acc.name;
    const corporateName = names?.corporate ?? acc.name;
    await prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: acc.code } },
      update: { name: acc.name, category: acc.category, soleName, corporateName },
      create: {
        tenantId: tid,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        soleName,
        corporateName,
      },
    });
    upserted++;
  }
  console.log(`✅ ${upserted} 件の家庭モード勘定科目を upsert しました（個人事業主・法人モードの表示名付き）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
