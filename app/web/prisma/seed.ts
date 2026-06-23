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

  // ─── 家庭向けマスタ（家庭＝一法人モデル）────────────────────────────
  // 家庭用勘定科目（コードプレフィックス H で法人用と区別）
  const householdAccounts = await Promise.all([
    // 収入
    prisma.account.upsert({ where: { code: "H1000" }, update: {}, create: { code: "H1000", name: "給与・賞与", category: "REVENUE" } }),
    prisma.account.upsert({ where: { code: "H1100" }, update: {}, create: { code: "H1100", name: "副業・フリーランス収入", category: "REVENUE" } }),
    prisma.account.upsert({ where: { code: "H1200" }, update: {}, create: { code: "H1200", name: "投資・配当収益", category: "REVENUE" } }),
    // 変動費（月ごとに変動する支出）
    prisma.account.upsert({ where: { code: "H2000" }, update: {}, create: { code: "H2000", name: "食費", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2100" }, update: {}, create: { code: "H2100", name: "日用品・消耗品", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2200" }, update: {}, create: { code: "H2200", name: "交通・移動費", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2300" }, update: {}, create: { code: "H2300", name: "娯楽・交際費", category: "COGS" } }),
    // 固定費（毎月ほぼ一定の支出）
    prisma.account.upsert({ where: { code: "H3000" }, update: {}, create: { code: "H3000", name: "家賃・住宅ローン", category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3100" }, update: {}, create: { code: "H3100", name: "水道光熱費", category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3200" }, update: {}, create: { code: "H3200", name: "通信費（スマホ・ネット）", category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3300" }, update: {}, create: { code: "H3300", name: "保険料（生命・医療・自動車）", category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3400" }, update: {}, create: { code: "H3400", name: "教育費", category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3500" }, update: {}, create: { code: "H3500", name: "医療・健康費", category: "EXPENSE" } }),
    // 貯蓄
    prisma.account.upsert({ where: { code: "H9000" }, update: {}, create: { code: "H9000", name: "貯蓄・投資積立", category: "PROFIT" } }),
  ]);

  // 家庭部門
  const familyDept = await prisma.department.upsert({
    where: { id: 2 },
    update: {},
    create: { name: "家庭" },
  });

  // 家庭向けサンプル実績（2025 年 1〜6 月）
  // 月収入 45 万円、支出合計 約 32 万円、貯蓄率 約 28%
  const householdData: Record<string, number[]> = {
    "H1000": [450_000, 450_000, 450_000, 450_000, 900_000, 450_000], // 4月は賞与月
    "H2000": [62_000, 58_000, 65_000, 60_000, 70_000, 63_000],
    "H2100": [14_000, 12_000, 18_000, 13_000, 15_000, 11_000],
    "H2200": [21_000, 19_000, 22_000, 20_000, 25_000, 20_000],
    "H2300": [28_000, 22_000, 35_000, 30_000, 45_000, 25_000],
    "H3000": [120_000, 120_000, 120_000, 120_000, 120_000, 120_000],
    "H3100": [18_000, 20_000, 16_000, 12_000, 10_000, 11_000],
    "H3200": [12_000, 12_000, 12_000, 12_000, 12_000, 12_000],
    "H3300": [30_000, 30_000, 30_000, 30_000, 30_000, 30_000],
    "H3400": [25_000, 25_000, 25_000, 25_000, 25_000, 25_000],
    "H3500": [5_000, 8_000, 3_000, 12_000, 4_000, 6_000],
  };
  // 月予算（収入 45 万・各費目の標準値）
  const householdBudget: Record<string, number> = {
    "H1000": 450_000,
    "H2000": 60_000, "H2100": 15_000, "H2200": 20_000, "H2300": 30_000,
    "H3000": 120_000, "H3100": 15_000, "H3200": 12_000,
    "H3300": 30_000, "H3400": 25_000, "H3500": 8_000,
  };

  for (const acct of householdAccounts) {
    const monthlyData = householdData[acct.code];
    const budgetAmount = householdBudget[acct.code];

    for (let month = 1; month <= 12; month++) {
      const quarter = Math.ceil(month / 3);
      const period = await prisma.period.upsert({
        where: { fiscalYear_month: { fiscalYear: 2025, month } },
        update: {},
        create: { fiscalYear: 2025, quarter, month },
      });

      if (monthlyData && month <= monthlyData.length) {
        await prisma.financialRecord.create({
          data: { accountId: acct.id, departmentId: familyDept.id, periodId: period.id, amount: monthlyData[month - 1] },
        });
      }

      if (budgetAmount) {
        await prisma.budget.upsert({
          where: { accountId_periodId: { accountId: acct.id, periodId: period.id } },
          update: {},
          create: { accountId: acct.id, periodId: period.id, amount: budgetAmount },
        });
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  // ─── 銀行口座と資金移動（口座間フロー）サンプル ────────────────────
  const salary = await prisma.bankAccount.upsert({
    where: { id: 1 }, update: {},
    create: { name: "給与口座", bankName: "みずほ銀行", branchName: "新宿支店", role: "SALARY" },
  });
  const withdrawal = await prisma.bankAccount.upsert({
    where: { id: 2 }, update: {},
    create: { name: "引き落とし口座", bankName: "三菱UFJ銀行", branchName: "渋谷支店", role: "WITHDRAWAL" },
  });
  const savings = await prisma.bankAccount.upsert({
    where: { id: 3 }, update: {},
    create: { name: "貯蓄口座", bankName: "住信SBIネット銀行", role: "SAVINGS" },
  });

  // 給与口座 → 引き落とし口座（毎月27日 自動）、給与口座 → 貯蓄（毎月25日 手動）
  const transfers = [
    { fromAccountId: salary.id, toAccountId: withdrawal.id, amount: 250_000, kind: "AUTO" as const, day: 27, note: "家賃・カード等の引き落とし用" },
    { fromAccountId: salary.id, toAccountId: savings.id, amount: 100_000, kind: "MANUAL" as const, day: 25, note: "貯蓄積立" },
  ];
  const existingTransfers = await prisma.transfer.count();
  if (existingTransfers === 0) {
    for (const t of transfers) await prisma.transfer.create({ data: t });
  }
  // ─────────────────────────────────────────────────────────────────────

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
