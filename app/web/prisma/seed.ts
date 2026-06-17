import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

async function main() {
  // 勘定科目
  const accounts = await Promise.all([
    prisma.account.upsert({ where: { code: "4000" }, update: {}, create: { code: "4000", name: "売上高", category: "REVENUE" } }),
    prisma.account.upsert({ where: { code: "5000" }, update: {}, create: { code: "5000", name: "売上原価", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "6000" }, update: {}, create: { code: "6000", name: "販売費及び一般管理費", category: "EXPENSE" } }),
  ]);
  const revenue = accounts[0];

  // 部門
  const dept = await prisma.department.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "全社" },
  });

  // 会計期間（2025 年 1〜12 月）と売上実績
  const baseRevenue = [12_000_000, 13_500_000, 15_200_000, 14_800_000, 16_100_000, 17_000_000];
  for (let month = 1; month <= 12; month++) {
    const quarter = Math.ceil(month / 3);
    const period = await prisma.period.upsert({
      where: { fiscalYear_month: { fiscalYear: 2025, month } },
      update: {},
      create: { fiscalYear: 2025, quarter, month },
    });

    // 1〜6 月のみ実績を投入（7 月以降は予測対象）
    if (month <= baseRevenue.length) {
      await prisma.financialRecord.create({
        data: {
          accountId: revenue.id,
          departmentId: dept.id,
          periodId: period.id,
          amount: baseRevenue[month - 1],
        },
      });
    }

    // 予算（売上）: 月 1,300 万円で計画
    await prisma.budget.upsert({
      where: { accountId_periodId: { accountId: revenue.id, periodId: period.id } },
      update: {},
      create: { accountId: revenue.id, periodId: period.id, amount: 13_000_000 },
    });
  }

  // ロール別ユーザー（admin / editor / viewer）
  const users = [
    { email: "admin@example.com", name: "管理者", role: "admin" },
    { email: "editor@example.com", name: "編集者", role: "editor" },
    { email: "viewer@example.com", name: "閲覧者", role: "viewer" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: hashPassword("password") },
    });
  }

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
