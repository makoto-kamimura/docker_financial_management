import { PrismaClient } from "@prisma/client";
import { seedDefaultAllocationRulesForTenant } from "../src/lib/default-allocation-rules";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

// NOTE: src/lib/auth.ts の hashPassword と同一実装。auth.ts は next/headers に依存し
// tsx（seed 実行環境）から import できないため、seed 専用に複製している。
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

// ── 月次収支データ ─────────────────────────────────────────────────────────
// モデル: 30代 会社員世帯（共働き二人暮らし）
// 主収入: 月収 40→45万 + 年2回ボーナス  副収入: 月収 22→26万

type MonthlyRow = { fiscalYear: number; month: number; amount: number };

function incomeRows(): MonthlyRow[] {
  const rows: MonthlyRow[] = [];
  const salary: Record<number, number> = {
    2023: 400_000,
    2024: 420_000,
    2025: 440_000,
    2026: 450_000,
  };
  const bonus: Record<number, number> = {
    2023: 620_000,
    2024: 660_000,
    2025: 700_000,
    2026: 720_000,
  };
  for (const [yearStr, base] of Object.entries(salary)) {
    const year = Number(yearStr);
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const b = m === 6 || m === 12 ? bonus[year] : 0;
      rows.push({ fiscalYear: year, month: m, amount: base + b });
    }
  }
  return rows;
}

function subIncomeRows(): MonthlyRow[] {
  const rows: MonthlyRow[] = [];
  const base: Record<number, number> = {
    2023: 220_000,
    2024: 230_000,
    2025: 250_000,
    2026: 260_000,
  };
  for (const [yearStr, amt] of Object.entries(base)) {
    const year = Number(yearStr);
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      rows.push({ fiscalYear: year, month: m, amount: amt });
    }
  }
  return rows;
}

// 変動費（COGS）月次データ（季節変動あり）
const FOOD_MONTHLY = [
  65_000, 60_000, 63_000, 68_000, 70_000, 73_000, 76_000, 78_000, 70_000, 66_000, 68_000, 82_000,
];
const DAILY_MONTHLY = [
  17_000, 14_000, 19_000, 15_000, 13_000, 21_000, 18_000, 16_000, 14_000, 17_000, 19_000, 24_000,
];
const TRANSPORT_MONTHLY = [
  20_000, 18_000, 19_000, 23_000, 26_000, 28_000, 30_000, 33_000, 26_000, 22_000, 20_000, 18_000,
];
const LEISURE_MONTHLY = [
  22_000, 18_000, 20_000, 32_000, 38_000, 48_000, 52_000, 58_000, 32_000, 25_000, 28_000, 42_000,
];

// 固定費（EXPENSE）月次データ
const UTILITIES_MONTHLY = [
  16_000, 18_000, 14_000, 9_000, 7_500, 8_500, 11_000, 13_000, 9_500, 7_500, 11_000, 16_000,
];

// 資産残高（月末時点）
function linearSeries(start: number, end: number, months = 42): number[] {
  return Array.from({ length: months }, (_, i) =>
    Math.round(start + ((end - start) * i) / (months - 1)),
  );
}

function stockSeries(start: number, end: number, months = 42): number[] {
  const trend = linearSeries(start, end, months);
  const waves = [
    0, 3, 6, 2, -1, -4, 5, 8, 3, -2, 4, 7, 2, -3, 5, 9, 4, -2, 6, 10, 3, -1, 4, 8, 2, -3, 5, 7, 3,
    -2, 4, 8, 2, -1, 3, 6, 1, -2, 4, 6, 2, 0,
  ];
  return trend.map((v, i) => Math.round(v + (waves[i % waves.length] ?? 0) * 10_000));
}

async function main() {
  console.log("🌱 Seeding start...");

  // ── 0. デモテナント作成 ─────────────────────────────────────────────────
  // デモデータ・デモユーザーはすべてこのテナント（id=1）に集約する。
  const demoTenant = await prisma.tenant.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "株式会社テックソリューション",
      type: "CORPORATION",
      corporateNumber: "1234567890123",
      capitalAmount: 10_000_000,
      establishedOn: new Date("2018-04-01"),
      closingMonth: 3,
    },
  });
  const tid = demoTenant.id;
  // 明示 ID (id=1) で upsert したため、autoincrement シーケンスを実データに同期させる
  // （ずれたままだと以降の tenant.create が id 重複で失敗する）
  await prisma.$executeRaw`SELECT setval('tenants_id_seq', GREATEST((SELECT MAX(id) FROM tenants), 1))`;
  console.log("  ✓ Upserted demo tenant");

  // ── 0b. デモユーザー（全員デモテナント所属）───────────────────────────────
  for (const u of [
    { email: "admin@example.com", name: "管理者", role: "admin" },
    { email: "editor@example.com", name: "編集者", role: "editor" },
    { email: "viewer@example.com", name: "閲覧者", role: "viewer" },
    { email: "demo@example.com", name: "デモユーザー", role: "editor" },
  ]) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { tenantId: tid, role: u.role },
      create: { ...u, tenantId: tid, passwordHash: hashPassword("password") },
    });
  }
  console.log("  ✓ Demo users ready (password: 'password')");

  // ── 1. 既存の取引データをクリア ──────────────────────────────────────────
  await prisma.financialRecord.deleteMany({});
  await prisma.budget.deleteMany({});
  await prisma.officer.deleteMany({});
  console.log("  ✓ Cleared financial records, budgets & officers");

  // ── 2. 勘定科目 upsert ─────────────────────────────────────────────────
  const accs = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H1000" } },
      update: { name: "給与・賞与" },
      create: { tenantId: tid, code: "H1000", name: "給与・賞与", category: "REVENUE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H1100" } },
      update: { name: "配偶者給与" },
      create: { tenantId: tid, code: "H1100", name: "配偶者給与", category: "REVENUE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H2000" } },
      update: { name: "食費" },
      create: { tenantId: tid, code: "H2000", name: "食費", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H2100" } },
      update: { name: "日用品・消耗品" },
      create: { tenantId: tid, code: "H2100", name: "日用品・消耗品", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H2200" } },
      update: { name: "交通費" },
      create: { tenantId: tid, code: "H2200", name: "交通費", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H2300" } },
      update: { name: "娯楽・外食費" },
      create: { tenantId: tid, code: "H2300", name: "娯楽・外食費", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H3000" } },
      update: { name: "家賃" },
      create: { tenantId: tid, code: "H3000", name: "家賃", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H3100" } },
      update: { name: "水道光熱費" },
      create: { tenantId: tid, code: "H3100", name: "水道光熱費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H3200" } },
      update: { name: "通信費" },
      create: { tenantId: tid, code: "H3200", name: "通信費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "H3300" } },
      update: { name: "保険料" },
      create: { tenantId: tid, code: "H3300", name: "保険料", category: "EXPENSE" },
    }),
  ]);
  const [h1000, h1100, h2000, h2100, h2200, h2300, h3000, h3100, h3200, h3300] = accs;

  // 資産口座 upsert（親科目）
  const haParents = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA100" } },
      update: {},
      create: { tenantId: tid, code: "HA100", name: "流動資産", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA200" } },
      update: {},
      create: { tenantId: tid, code: "HA200", name: "投資・有価証券", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA300" } },
      update: {},
      create: { tenantId: tid, code: "HA300", name: "保険資産", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA400" } },
      update: {},
      create: { tenantId: tid, code: "HA400", name: "年金・退職金資産", category: "ASSET" },
    }),
  ]);
  const [ha100, ha200, ha300, ha400] = haParents;

  // 資産口座 upsert（子科目）
  const haChildren = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA101" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA101",
        name: "積立預金",
        category: "ASSET",
        parentId: ha100.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA102" } },
      update: {},
      create: { tenantId: tid, code: "HA102", name: "現金", category: "ASSET", parentId: ha100.id },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA103" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA103",
        name: "普通預金",
        category: "ASSET",
        parentId: ha100.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA104" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA104",
        name: "定期預金",
        category: "ASSET",
        parentId: ha100.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA201" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA201",
        name: "国内株式",
        category: "ASSET",
        parentId: ha200.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA202" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA202",
        name: "外国株式",
        category: "ASSET",
        parentId: ha200.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA203" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA203",
        name: "国内債券",
        category: "ASSET",
        parentId: ha200.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA204" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA204",
        name: "外国債券",
        category: "ASSET",
        parentId: ha200.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA301" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA301",
        name: "生命保険（終身）",
        category: "ASSET",
        parentId: ha300.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA302" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA302",
        name: "学資保険",
        category: "ASSET",
        parentId: ha300.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA401" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA401",
        name: "厚生年金",
        category: "ASSET",
        parentId: ha400.id,
      },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "HA402" } },
      update: {},
      create: {
        tenantId: tid,
        code: "HA402",
        name: "退職金（見込）",
        category: "ASSET",
        parentId: ha400.id,
      },
    }),
  ]);
  const [ha101, ha102, ha103, ha104, ha201, ha202, ha203, ha204, ha301, ha302, ha401, ha402] =
    haChildren;

  console.log("  ✓ Upserted accounts");

  // 部門
  const dept = await prisma.department.upsert({
    where: { id: 1 },
    update: {},
    create: { tenantId: tid, name: "家計" },
  });

  // ── 3. 会計期間生成（2023-01 〜 2026-06）──────────────────────────────────
  const periodMap = new Map<string, { id: number }>();
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const p = await prisma.period.upsert({
        where: { tenantId_fiscalYear_month: { tenantId: tid, fiscalYear: year, month } },
        update: {},
        create: { tenantId: tid, fiscalYear: year, month, quarter: Math.ceil(month / 3) },
      });
      periodMap.set(`${year}-${month}`, p);
    }
  }
  console.log("  ✓ Created periods (2023-01 ~ 2026-06)");

  // ── 4. 収支 financial records ───────────────────────────────────────────
  async function insertRows(accountId: number, rows: MonthlyRow[]) {
    for (const row of rows) {
      const p = periodMap.get(`${row.fiscalYear}-${row.month}`);
      if (!p) continue;
      await prisma.financialRecord.create({
        data: {
          tenantId: tid,
          accountId,
          departmentId: dept.id,
          periodId: p.id,
          amount: row.amount,
        },
      });
    }
  }

  await insertRows(h1000.id, incomeRows());
  await insertRows(h1100.id, subIncomeRows());

  // 変動費（COGS）
  for (const [year, scale] of [
    [2023, 1.0],
    [2024, 1.04],
    [2025, 1.07],
    [2026, 1.09],
  ] as [number, number][]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      await prisma.financialRecord.createMany({
        data: [
          {
            accountId: h2000.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: Math.round(FOOD_MONTHLY[i] * scale),
          },
          {
            accountId: h2100.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: Math.round(DAILY_MONTHLY[i] * scale),
          },
          {
            accountId: h2200.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: Math.round(TRANSPORT_MONTHLY[i] * scale),
          },
          {
            accountId: h2300.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: Math.round(LEISURE_MONTHLY[i] * scale),
          },
        ].map((r) => ({ ...r, tenantId: tid })),
      });
    }
  }

  // 固定費（EXPENSE）
  for (const year of [2023, 2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      const commScale = year >= 2025 ? 0.85 : 1.0; // 2025年にプラン見直しで通信費削減
      await prisma.financialRecord.createMany({
        data: [
          { accountId: h3000.id, departmentId: dept.id, periodId: p.id, amount: 115_000 },
          {
            accountId: h3100.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: UTILITIES_MONTHLY[i],
          },
          {
            accountId: h3200.id,
            departmentId: dept.id,
            periodId: p.id,
            amount: Math.round(11_000 * commScale),
          },
          { accountId: h3300.id, departmentId: dept.id, periodId: p.id, amount: 28_000 },
        ].map((r) => ({ ...r, tenantId: tid })),
      });
    }
  }

  console.log("  ✓ Created income & expense records");

  // ── 5. 資産残高（月末）──────────────────────────────────────────────────
  const assetData: [number, number[]][] = [
    [ha101.id, linearSeries(200_000, 1_500_000)], // 積立預金: 毎月1万ずつ積み上げ
    [
      ha102.id,
      [
        // 現金: 月々変動
        55_000, 48_000, 62_000, 42_000, 58_000, 50_000, 53_000, 67_000, 57_000, 44_000, 60_000,
        40_000, 57_000, 49_000, 65_000, 43_000, 59_000, 52_000, 55_000, 70_000, 53_000, 47_000,
        63_000, 43_000, 59_000, 51_000, 68_000, 45_000, 61_000, 53_000, 57_000, 72_000, 54_000,
        48_000, 64_000, 43_000, 61_000, 53_000, 69_000, 46_000, 62_000, 55_000,
      ],
    ],
    [ha103.id, linearSeries(2_200_000, 6_500_000)], // 普通預金: 着実に増加
    [
      ha104.id,
      [
        // 定期預金: 年初に一括追加
        ...Array(12).fill(1_000_000),
        ...Array(12).fill(1_500_000),
        ...Array(12).fill(2_200_000),
        ...Array(6).fill(2_200_000),
      ],
    ],
    [ha201.id, stockSeries(900_000, 3_200_000)], // 国内株式
    [ha202.id, stockSeries(400_000, 1_500_000)], // 外国株式
    [ha203.id, linearSeries(500_000, 720_000)], // 国内債券: 安定
    [ha204.id, linearSeries(200_000, 650_000)], // 外国債券
    [ha301.id, linearSeries(2_800_000, 3_300_000)], // 生命保険（終身）
    [ha302.id, linearSeries(900_000, 1_380_000)], // 学資保険
    [ha401.id, linearSeries(3_200_000, 4_400_000)], // 厚生年金
    [ha402.id, linearSeries(5_500_000, 6_800_000)], // 退職金（見込）
  ];

  let monthIndex = 0;
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) {
        monthIndex++;
        continue;
      }
      for (const [accId, series] of assetData) {
        const amount = series[monthIndex];
        if (amount == null) continue;
        await prisma.financialRecord.create({
          data: { tenantId: tid, accountId: accId, departmentId: dept.id, periodId: p.id, amount },
        });
      }
      monthIndex++;
    }
  }

  console.log("  ✓ Created asset balance records");

  // ── 6. 予算（年間計画）─────────────────────────────────────────────────
  const budgetDef: [number, number][] = [
    [h1000.id, 6_000_000], // 給与・賞与: 月50万×12
    [h1100.id, 3_000_000], // 配偶者給与: 月25万×12
    [h2000.id, 840_000], // 食費: 月7万×12
    [h2100.id, 216_000], // 日用品: 月1.8万×12
    [h2200.id, 276_000], // 交通費: 月2.3万×12
    [h2300.id, 360_000], // 娯楽: 月3万×12
    [h3000.id, 1_380_000], // 家賃: 月11.5万×12
    [h3100.id, 144_000], // 光熱費: 月1.2万×12
    [h3200.id, 120_000], // 通信費: 月1万×12
    [h3300.id, 336_000], // 保険料: 月2.8万×12
  ];

  for (const year of [2023, 2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      for (const [accId, annual] of budgetDef) {
        await prisma.budget.upsert({
          where: {
            tenantId_accountId_periodId: { tenantId: tid, accountId: accId, periodId: p.id },
          },
          update: { amount: Math.round(annual / 12) },
          create: {
            tenantId: tid,
            accountId: accId,
            periodId: p.id,
            amount: Math.round(annual / 12),
          },
        });
      }
    }
  }

  // ── 7. 銀行口座と資金移動 ───────────────────────────────────────────────
  const salaryAcc = await prisma.bankAccount.upsert({
    where: { id: 1 },
    update: {},
    create: {
      tenantId: tid,
      name: "給与口座",
      bankName: "三菱UFJ銀行",
      branchName: "新宿支店",
      role: "SALARY",
    },
  });
  const withdrawalAcc = await prisma.bankAccount.upsert({
    where: { id: 2 },
    update: {},
    create: {
      tenantId: tid,
      name: "生活費口座",
      bankName: "みずほ銀行",
      branchName: "渋谷支店",
      role: "WITHDRAWAL",
    },
  });
  const savingsAcc = await prisma.bankAccount.upsert({
    where: { id: 3 },
    update: {},
    create: { tenantId: tid, name: "貯蓄口座", bankName: "住信SBIネット銀行", role: "SAVINGS" },
  });

  const transferList = [
    {
      fromAccountId: null,
      toAccountId: salaryAcc.id,
      amount: 450_000,
      kind: "AUTO" as const,
      channel: "INCOME" as const,
      label: "給与",
      day: 25,
      note: "毎月25日給与振込",
    },
    {
      fromAccountId: salaryAcc.id,
      toAccountId: withdrawalAcc.id,
      amount: 200_000,
      kind: "AUTO" as const,
      channel: "BANK_TRANSFER" as const,
      day: 26,
      note: "生活費口座へ振替",
    },
    {
      fromAccountId: salaryAcc.id,
      toAccountId: savingsAcc.id,
      amount: 100_000,
      kind: "MANUAL" as const,
      channel: "BANK_TRANSFER" as const,
      day: 25,
      note: "貯蓄自動積立",
    },
    {
      fromAccountId: withdrawalAcc.id,
      toAccountId: null,
      amount: 115_000,
      kind: "AUTO" as const,
      channel: "AUTO_DEBIT" as const,
      label: "家賃",
      day: 27,
      note: "家賃 口座振替",
    },
    {
      fromAccountId: withdrawalAcc.id,
      toAccountId: null,
      amount: 85_000,
      kind: "AUTO" as const,
      channel: "CARD_PAYMENT" as const,
      label: "クレジットカード",
      day: 27,
      note: "カード利用分引落し",
    },
  ];
  const existingTransfers = await prisma.transfer.count();
  if (existingTransfers === 0) {
    for (const t of transferList) await prisma.transfer.create({ data: { ...t, tenantId: tid } });
  }

  // ── 8. 入出金明細（直近3か月）──────────────────────────────────────────
  const existingTxns = await prisma.bankTransaction.count();
  if (existingTxns === 0) {
    // 給与口座: 初期残高 150,000
    const salaryTxns = [
      { date: "2026-04-25", description: "給与振込", amount: 450_000, balance: 600_000 },
      { date: "2026-04-25", description: "積立定期 自動振替", amount: -100_000, balance: 500_000 },
      {
        date: "2026-04-26",
        description: "みずほ銀行 口座振替",
        amount: -200_000,
        balance: 300_000,
      },
      { date: "2026-04-28", description: "ATM 出金", amount: -30_000, balance: 270_000 },
      { date: "2026-05-25", description: "給与振込", amount: 450_000, balance: 720_000 },
      { date: "2026-05-25", description: "積立定期 自動振替", amount: -100_000, balance: 620_000 },
      {
        date: "2026-05-26",
        description: "みずほ銀行 口座振替",
        amount: -200_000,
        balance: 420_000,
      },
      { date: "2026-05-30", description: "ATM 出金", amount: -30_000, balance: 390_000 },
      { date: "2026-06-25", description: "給与振込", amount: 450_000, balance: 840_000 },
      { date: "2026-06-25", description: "積立定期 自動振替", amount: -100_000, balance: 740_000 },
      {
        date: "2026-06-26",
        description: "みずほ銀行 口座振替",
        amount: -200_000,
        balance: 540_000,
      },
    ];
    // 生活費口座: 初期残高 50,000
    const withdrawalTxns = [
      {
        date: "2026-04-26",
        description: "三菱UFJ銀行 振込入金",
        amount: 200_000,
        balance: 250_000,
      },
      { date: "2026-04-27", description: "家賃 口座振替", amount: -115_000, balance: 135_000 },
      {
        date: "2026-04-27",
        description: "クレジットカード 利用分",
        amount: -85_000,
        balance: 50_000,
      },
      { date: "2026-04-28", description: "電気代 口座振替", amount: -12_500, balance: 37_500 },
      { date: "2026-04-28", description: "ガス代 口座振替", amount: -8_000, balance: 29_500 },
      {
        date: "2026-04-28",
        description: "インターネット料金 口座振替",
        amount: -5_500,
        balance: 24_000,
      },
      {
        date: "2026-05-26",
        description: "三菱UFJ銀行 振込入金",
        amount: 200_000,
        balance: 224_000,
      },
      { date: "2026-05-27", description: "家賃 口座振替", amount: -115_000, balance: 109_000 },
      {
        date: "2026-05-27",
        description: "クレジットカード 利用分",
        amount: -92_000,
        balance: 17_000,
      },
      { date: "2026-05-28", description: "電気代 口座振替", amount: -11_800, balance: 5_200 },
      { date: "2026-05-28", description: "ガス代 口座振替", amount: -7_500, balance: -2_300 },
      {
        date: "2026-05-29",
        description: "三菱UFJ銀行 振込入金（臨時）",
        amount: 30_000,
        balance: 27_700,
      },
      {
        date: "2026-05-29",
        description: "インターネット料金 口座振替",
        amount: -5_500,
        balance: 22_200,
      },
      {
        date: "2026-06-26",
        description: "三菱UFJ銀行 振込入金",
        amount: 200_000,
        balance: 222_200,
      },
      { date: "2026-06-27", description: "家賃 口座振替", amount: -115_000, balance: 107_200 },
      {
        date: "2026-06-27",
        description: "クレジットカード 利用分",
        amount: -78_000,
        balance: 29_200,
      },
      { date: "2026-06-28", description: "電気代 口座振替", amount: -13_500, balance: 15_700 },
      { date: "2026-06-28", description: "ガス代 口座振替", amount: -7_200, balance: 8_500 },
    ];
    // 貯蓄口座: 初期残高 2,400,000
    const savingsTxns = [
      { date: "2026-04-10", description: "定期預金 満期解約", amount: 500_000, balance: 2_900_000 },
      {
        date: "2026-04-25",
        description: "積立定期 自動振替 入金",
        amount: 100_000,
        balance: 3_000_000,
      },
      {
        date: "2026-05-25",
        description: "積立定期 自動振替 入金",
        amount: 100_000,
        balance: 3_100_000,
      },
      {
        date: "2026-06-05",
        description: "ATM 出金（一時費用）",
        amount: -80_000,
        balance: 3_020_000,
      },
      {
        date: "2026-06-25",
        description: "積立定期 自動振替 入金",
        amount: 100_000,
        balance: 3_120_000,
      },
    ];

    const toCreate = [
      ...salaryTxns.map((t) => ({ ...t, accountId: salaryAcc.id })),
      ...withdrawalTxns.map((t) => ({ ...t, accountId: withdrawalAcc.id })),
      ...savingsTxns.map((t) => ({ ...t, accountId: savingsAcc.id })),
    ];
    for (const t of toCreate) {
      await prisma.bankTransaction.create({
        data: {
          accountId: t.accountId,
          date: new Date(t.date),
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          source: "MANUAL",
        },
      });
    }
    console.log(`  ✓ Created ${toCreate.length} bank transactions`);
  }
  console.log("  ✓ Created budgets & bank transfers");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 10. 個人事業主モード デモデータ（ITフリーランサー 田中 太郎）────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // 勘定科目 upsert（seed-business-accounts.ts の代表科目のみ）
  const soleAccs = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "4000" } },
      update: {},
      create: { tenantId: tid, code: "4000", name: "売上高", category: "REVENUE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "5000" } },
      update: {},
      create: { tenantId: tid, code: "5000", name: "外注費", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7000" } },
      update: {},
      create: { tenantId: tid, code: "7000", name: "通信費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7100" } },
      update: {},
      create: { tenantId: tid, code: "7100", name: "消耗品費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7400" } },
      update: {},
      create: { tenantId: tid, code: "7400", name: "会議費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7500" } },
      update: {},
      create: { tenantId: tid, code: "7500", name: "地代家賃", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7600" } },
      update: {},
      create: { tenantId: tid, code: "7600", name: "減価償却費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7900" } },
      update: {},
      create: { tenantId: tid, code: "7900", name: "広告宣伝費", category: "EXPENSE" },
    }),
  ]);
  const [s4000, s5000, s7000, s7100, s7400, s7500, s7600, s7900] = soleAccs;

  const soleDept = await prisma.department.upsert({
    where: { id: 2 },
    update: {},
    create: { id: 2, tenantId: tid, name: "事業" },
  });

  // 月次売上（季節変動あり）
  const SOLE_REV_BASE: Record<number, number> = {
    2023: 600_000,
    2024: 780_000,
    2025: 1_000_000,
    2026: 1_080_000,
  };
  const SOLE_REV_FACTORS = [0.85, 0.75, 1.0, 1.05, 0.95, 1.1, 0.9, 0.7, 1.05, 1.0, 0.95, 1.0];
  // 外注費（月次）
  const SOLE_SUBCONTRACT = [
    100_000, 80_000, 150_000, 120_000, 100_000, 200_000, 150_000, 80_000, 180_000, 120_000, 100_000,
    150_000,
  ];

  for (const [yearStr, base] of Object.entries(SOLE_REV_BASE)) {
    const year = Number(yearStr);
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      const rev = Math.round(base * SOLE_REV_FACTORS[i]);
      await prisma.financialRecord.createMany({
        data: [
          { accountId: s4000.id, departmentId: soleDept.id, periodId: p.id, amount: rev },
          {
            accountId: s5000.id,
            departmentId: soleDept.id,
            periodId: p.id,
            amount: Math.round(SOLE_SUBCONTRACT[i] * (year >= 2025 ? 1.1 : 1.0)),
          },
          { accountId: s7500.id, departmentId: soleDept.id, periodId: p.id, amount: 150_000 },
          { accountId: s7000.id, departmentId: soleDept.id, periodId: p.id, amount: 35_000 },
          { accountId: s7100.id, departmentId: soleDept.id, periodId: p.id, amount: 20_000 },
          { accountId: s7400.id, departmentId: soleDept.id, periodId: p.id, amount: 15_000 },
          { accountId: s7600.id, departmentId: soleDept.id, periodId: p.id, amount: 20_000 },
          { accountId: s7900.id, departmentId: soleDept.id, periodId: p.id, amount: 10_000 },
        ].map((r) => ({ ...r, tenantId: tid })),
      });
    }
  }
  console.log("  ✓ Created sole proprietor financial records");

  // 予算（個人事業主）
  const soleBudgetDef: [number, number][] = [
    [s4000.id, 1_080_000], // 売上 月108万目標
    [s5000.id, 130_000], // 外注費
    [s7500.id, 150_000],
    [s7000.id, 35_000],
    [s7100.id, 20_000],
    [s7400.id, 15_000],
    [s7600.id, 20_000],
    [s7900.id, 10_000],
  ];
  for (const year of [2023, 2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 6 : 12;
    const revTarget =
      { 2023: 600_000, 2024: 780_000, 2025: 1_000_000, 2026: 1_080_000 }[year] ?? 1_000_000;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      for (const [accId, monthly] of soleBudgetDef) {
        const amount = accId === s4000.id ? revTarget : monthly;
        await prisma.budget.upsert({
          where: {
            tenantId_accountId_periodId: { tenantId: tid, accountId: accId, periodId: p.id },
          },
          update: { amount },
          create: { tenantId: tid, accountId: accId, periodId: p.id, amount },
        });
      }
    }
  }
  console.log("  ✓ Created sole proprietor budgets");

  // 銀行口座（個人事業主）
  const soleBusinessAcc = await prisma.bankAccount.upsert({
    where: { id: 4 },
    update: {},
    create: {
      id: 4,
      tenantId: tid,
      name: "事業用口座",
      bankName: "三井住友銀行",
      branchName: "渋谷支店",
      role: "SALARY",
    },
  });
  const soleTaxAcc = await prisma.bankAccount.upsert({
    where: { id: 5 },
    update: {},
    create: {
      id: 5,
      tenantId: tid,
      name: "納税積立口座",
      bankName: "ゆうちょ銀行",
      role: "SAVINGS",
    },
  });

  const soleTxnCount = await prisma.bankTransaction.count({ where: { accountId: { in: [4, 5] } } });
  if (soleTxnCount === 0) {
    const soleBusinessTxns = [
      { date: "2026-04-10", description: "A社 案件入金", amount: 1_200_000, balance: 2_850_000 },
      { date: "2026-04-15", description: "B社 案件入金", amount: 500_000, balance: 3_350_000 },
      { date: "2026-04-25", description: "納税積立 振替", amount: -300_000, balance: 3_050_000 },
      {
        date: "2026-04-28",
        description: "地代家賃 口座振替",
        amount: -150_000,
        balance: 2_900_000,
      },
      { date: "2026-04-30", description: "通信費 口座振替", amount: -35_000, balance: 2_865_000 },
      { date: "2026-05-12", description: "A社 案件入金", amount: 1_000_000, balance: 3_865_000 },
      {
        date: "2026-05-20",
        description: "C社 案件入金（先払い）",
        amount: 600_000,
        balance: 4_465_000,
      },
      { date: "2026-05-25", description: "納税積立 振替", amount: -300_000, balance: 4_165_000 },
      {
        date: "2026-05-28",
        description: "地代家賃 口座振替",
        amount: -150_000,
        balance: 4_015_000,
      },
      { date: "2026-05-30", description: "外注費 B社支払い", amount: -200_000, balance: 3_815_000 },
      { date: "2026-06-10", description: "A社 案件入金", amount: 1_100_000, balance: 4_915_000 },
      { date: "2026-06-20", description: "B社 案件入金", amount: 600_000, balance: 5_515_000 },
      { date: "2026-06-25", description: "納税積立 振替", amount: -300_000, balance: 5_215_000 },
      {
        date: "2026-06-28",
        description: "地代家賃 口座振替",
        amount: -150_000,
        balance: 5_065_000,
      },
    ];
    const soleTaxTxns = [
      {
        date: "2026-04-25",
        description: "事業用口座 振替入金",
        amount: 300_000,
        balance: 1_800_000,
      },
      {
        date: "2026-05-25",
        description: "事業用口座 振替入金",
        amount: 300_000,
        balance: 2_100_000,
      },
      {
        date: "2026-06-25",
        description: "事業用口座 振替入金",
        amount: 300_000,
        balance: 2_400_000,
      },
    ];
    for (const t of soleBusinessTxns) {
      await prisma.bankTransaction.create({
        data: {
          accountId: soleBusinessAcc.id,
          date: new Date(t.date),
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          source: "MANUAL",
        },
      });
    }
    for (const t of soleTaxTxns) {
      await prisma.bankTransaction.create({
        data: {
          accountId: soleTaxAcc.id,
          date: new Date(t.date),
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          source: "MANUAL",
        },
      });
    }
    console.log("  ✓ Created sole proprietor bank transactions");
  }

  // ── 個人事業主: B/S 勘定科目（仕訳用）─────────────────────────────────────
  const [s1000, s1100, s1300, , s3100, , s8000] = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "1000" } },
      update: {},
      create: { tenantId: tid, code: "1000", name: "現金", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "1100" } },
      update: {},
      create: { tenantId: tid, code: "1100", name: "普通預金", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "1300" } },
      update: {},
      create: { tenantId: tid, code: "1300", name: "売掛金", category: "ASSET" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "3000" } },
      update: {},
      create: { tenantId: tid, code: "3000", name: "買掛金", category: "LIABILITY" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "3100" } },
      update: {},
      create: { tenantId: tid, code: "3100", name: "未払金", category: "LIABILITY" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "7700" } },
      update: {},
      create: { tenantId: tid, code: "7700", name: "給与賃金", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "8000" } },
      update: {},
      create: { tenantId: tid, code: "8000", name: "接待交際費", category: "EXPENSE" },
    }),
  ]);

  // ── 個人事業主: 仕訳帳デモデータ（2025-12 〜 2026-06）──────────────────────
  await prisma.journalEntry.deleteMany({});

  type JeDef = {
    transactionDate: Date;
    description: string;
    paymentMethod: string;
    taxCategory: string;
    approvalStatus: string;
    details: {
      side: "debit" | "credit";
      accountId: number;
      amount: number;
      taxRate?: number;
      taxCreditEligible?: boolean;
    }[];
  };

  const JE: JeDef[] = [
    // 売上計上
    {
      transactionDate: new Date("2025-12-05"),
      description: "A社 Webサイト制作売上 12月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 550000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 500000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 50000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2025-12-20"),
      description: "B社 コンサルティング売上 12月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 330000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 300000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 30000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-01-10"),
      description: "A社 システム保守売上 1月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1100.id,
          amount: 220000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 200000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 20000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-01-25"),
      description: "C社 デザイン制作売上",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 165000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 150000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 15000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-02-05"),
      description: "A社 Webサイト制作売上 2月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 550000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 500000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 50000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-02-18"),
      description: "D社 LP制作売上",
      paymentMethod: "bank",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1100.id,
          amount: 88000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 80000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 8000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-03-07"),
      description: "B社 コンサルティング売上 3月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 330000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 300000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 30000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-03-25"),
      description: "E社 SNS運用代行売上 3月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 132000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 120000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 12000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-04-10"),
      description: "A社 システム保守売上 4月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1100.id,
          amount: 220000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 200000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 20000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-04-22"),
      description: "F社 動画制作売上",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 275000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 250000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 25000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-05-09"),
      description: "C社 UI/UXデザイン売上",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 198000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 180000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 18000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-05-28"),
      description: "B社 コンサルティング売上 5月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 330000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 300000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 30000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-06-05"),
      description: "A社 システム保守売上 6月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s1100.id,
          amount: 220000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 200000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 20000, taxCreditEligible: false },
      ],
    },
    {
      transactionDate: new Date("2026-06-20"),
      description: "G社 ECサイト構築売上",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "pending",
      details: [
        {
          side: "debit",
          accountId: s1300.id,
          amount: 880000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        {
          side: "credit",
          accountId: s4000.id,
          amount: 800000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "credit", accountId: s3100.id, amount: 80000, taxCreditEligible: false },
      ],
    },
    // 外注費
    {
      transactionDate: new Date("2026-01-31"),
      description: "外注エンジニア費 1月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s5000.id,
          amount: 200000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 20000, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1100.id,
          amount: 220000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    {
      transactionDate: new Date("2026-02-28"),
      description: "外注エンジニア費 2月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s5000.id,
          amount: 200000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 20000, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1100.id,
          amount: 220000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    {
      transactionDate: new Date("2026-03-31"),
      description: "フリーランスデザイナー 3月分",
      paymentMethod: "transfer",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s5000.id,
          amount: 80000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 8000, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1100.id,
          amount: 88000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    // 地代家賃
    ...([1, 2, 3, 4, 5, 6] as const).map((m) => ({
      transactionDate: new Date(`2026-0${m}-01`),
      description: `事務所家賃 ${m}月分`,
      paymentMethod: "transfer",
      taxCategory: "non_taxable",
      approvalStatus: "approved",
      details: [
        { side: "debit" as const, accountId: s7500.id, amount: 150000, taxCreditEligible: false },
        { side: "credit" as const, accountId: s1100.id, amount: 150000, taxCreditEligible: false },
      ],
    })),
    // 消耗品・通信費
    {
      transactionDate: new Date("2026-01-15"),
      description: "ノートPC購入 (消耗品費)",
      paymentMethod: "card",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s7100.id,
          amount: 120000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 12000, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1100.id,
          amount: 132000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    ...([2, 3, 4, 5, 6] as const).map((m) => ({
      transactionDate: new Date(`2026-0${m}-10`),
      description: `クラウドサービス利用料 ${m}月分`,
      paymentMethod: "card",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit" as const,
          accountId: s7000.id,
          amount: 30000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit" as const, accountId: s3100.id, amount: 3000, taxCreditEligible: false },
        {
          side: "credit" as const,
          accountId: s1100.id,
          amount: 33000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    })),
    {
      transactionDate: new Date("2026-04-20"),
      description: "ソフトウェアライセンス更新",
      paymentMethod: "card",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s7000.id,
          amount: 50000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 5000, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1100.id,
          amount: 55000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    // 会議費・接待費
    {
      transactionDate: new Date("2026-02-15"),
      description: "A社打ち合わせ 会議費",
      paymentMethod: "cash",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        { side: "debit", accountId: s7400.id, amount: 8000, taxRate: 0.1, taxCreditEligible: true },
        { side: "debit", accountId: s3100.id, amount: 800, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1000.id,
          amount: 8800,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    {
      transactionDate: new Date("2026-03-20"),
      description: "B社接待費",
      paymentMethod: "cash",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        {
          side: "debit",
          accountId: s8000.id,
          amount: 25000,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
        { side: "debit", accountId: s3100.id, amount: 2500, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1000.id,
          amount: 27500,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
    {
      transactionDate: new Date("2026-05-15"),
      description: "C社打ち合わせ 会議費",
      paymentMethod: "cash",
      taxCategory: "taxable",
      approvalStatus: "approved",
      details: [
        { side: "debit", accountId: s7400.id, amount: 6000, taxRate: 0.1, taxCreditEligible: true },
        { side: "debit", accountId: s3100.id, amount: 600, taxCreditEligible: false },
        {
          side: "credit",
          accountId: s1000.id,
          amount: 6600,
          taxRate: 0.1,
          taxCreditEligible: true,
        },
      ],
    },
  ];

  for (const je of JE) {
    await prisma.journalEntry.create({
      data: {
        tenantId: tid,
        transactionDate: je.transactionDate,
        description: je.description,
        paymentMethod: je.paymentMethod,
        taxCategory: je.taxCategory,
        approvalStatus: je.approvalStatus,
        details: {
          create: je.details.map((d) => ({
            side: d.side,
            accountId: d.accountId,
            amount: d.amount,
            taxRate: d.taxRate ?? null,
            taxCreditEligible: d.taxCreditEligible ?? true,
          })),
        },
      },
    });
  }
  console.log(`  ✓ Created ${JE.length} journal entries`);

  // ── 個人事業主: インボイスデモデータ─────────────────────────────────────────
  await prisma.invoice.deleteMany({});

  type InvDef = {
    invoiceNumber: string;
    customerName: string;
    customerAddress: string;
    issueDate: Date;
    dueDate: Date;
    status: string;
    subtotal: number;
    taxAmount: number;
    total: number;
    note?: string;
    lines: {
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      amount: number;
    }[];
  };

  const INVOICES: InvDef[] = [
    {
      invoiceNumber: "INV-2025-001",
      customerName: "株式会社アルファ",
      customerAddress: "東京都渋谷区xxx-xxx",
      issueDate: new Date("2025-12-05"),
      dueDate: new Date("2026-01-05"),
      status: "paid",
      subtotal: 500000,
      taxAmount: 50000,
      total: 550000,
      note: "Webサイト制作費 (12月分)",
      lines: [
        {
          description: "Webサイト設計・デザイン",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "フロントエンド実装",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "CMS導入・設定",
          quantity: 1,
          unitPrice: 100000,
          taxRate: 0.1,
          amount: 100000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2025-002",
      customerName: "株式会社ベータ",
      customerAddress: "東京都新宿区xxx-xxx",
      issueDate: new Date("2025-12-20"),
      dueDate: new Date("2026-01-20"),
      status: "paid",
      subtotal: 300000,
      taxAmount: 30000,
      total: 330000,
      note: "コンサルティング費 (12月分)",
      lines: [
        {
          description: "コンサルティング (15h)",
          quantity: 15,
          unitPrice: 20000,
          taxRate: 0.1,
          amount: 300000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-001",
      customerName: "株式会社アルファ",
      customerAddress: "東京都渋谷区xxx-xxx",
      issueDate: new Date("2026-01-10"),
      dueDate: new Date("2026-02-10"),
      status: "paid",
      subtotal: 200000,
      taxAmount: 20000,
      total: 220000,
      note: "システム保守費 (1月分)",
      lines: [
        {
          description: "システム保守・監視",
          quantity: 1,
          unitPrice: 150000,
          taxRate: 0.1,
          amount: 150000,
        },
        {
          description: "軽微な修正対応",
          quantity: 2,
          unitPrice: 25000,
          taxRate: 0.1,
          amount: 50000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-002",
      customerName: "有限会社シータ",
      customerAddress: "大阪府大阪市xxx-xxx",
      issueDate: new Date("2026-01-25"),
      dueDate: new Date("2026-02-25"),
      status: "paid",
      subtotal: 150000,
      taxAmount: 15000,
      total: 165000,
      note: "Webデザイン制作費",
      lines: [
        {
          description: "ページデザイン (5ページ)",
          quantity: 5,
          unitPrice: 20000,
          taxRate: 0.1,
          amount: 100000,
        },
        {
          description: "バナー制作 (10点)",
          quantity: 10,
          unitPrice: 5000,
          taxRate: 0.1,
          amount: 50000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-003",
      customerName: "株式会社アルファ",
      customerAddress: "東京都渋谷区xxx-xxx",
      issueDate: new Date("2026-02-05"),
      dueDate: new Date("2026-03-07"),
      status: "paid",
      subtotal: 500000,
      taxAmount: 50000,
      total: 550000,
      note: "Webサイト制作費 (2月分)",
      lines: [
        {
          description: "Webサイト設計・デザイン",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "フロントエンド実装",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "CMS導入・設定",
          quantity: 1,
          unitPrice: 100000,
          taxRate: 0.1,
          amount: 100000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-004",
      customerName: "デルタ合同会社",
      customerAddress: "神奈川県横浜市xxx-xxx",
      issueDate: new Date("2026-02-18"),
      dueDate: new Date("2026-03-20"),
      status: "paid",
      subtotal: 80000,
      taxAmount: 8000,
      total: 88000,
      note: "LPデザイン・制作費",
      lines: [
        { description: "LPデザイン", quantity: 1, unitPrice: 50000, taxRate: 0.1, amount: 50000 },
        { description: "HTML/CSS実装", quantity: 1, unitPrice: 30000, taxRate: 0.1, amount: 30000 },
      ],
    },
    {
      invoiceNumber: "INV-2026-005",
      customerName: "株式会社ベータ",
      customerAddress: "東京都新宿区xxx-xxx",
      issueDate: new Date("2026-03-07"),
      dueDate: new Date("2026-04-07"),
      status: "paid",
      subtotal: 300000,
      taxAmount: 30000,
      total: 330000,
      note: "コンサルティング費 (3月分)",
      lines: [
        {
          description: "コンサルティング (15h)",
          quantity: 15,
          unitPrice: 20000,
          taxRate: 0.1,
          amount: 300000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-006",
      customerName: "イプシロン株式会社",
      customerAddress: "福岡県福岡市xxx-xxx",
      issueDate: new Date("2026-03-25"),
      dueDate: new Date("2026-04-25"),
      status: "paid",
      subtotal: 120000,
      taxAmount: 12000,
      total: 132000,
      note: "SNS運用代行費 (3月分)",
      lines: [
        {
          description: "SNSコンテンツ企画・制作",
          quantity: 4,
          unitPrice: 15000,
          taxRate: 0.1,
          amount: 60000,
        },
        {
          description: "SNS投稿・運用管理",
          quantity: 1,
          unitPrice: 60000,
          taxRate: 0.1,
          amount: 60000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-007",
      customerName: "株式会社アルファ",
      customerAddress: "東京都渋谷区xxx-xxx",
      issueDate: new Date("2026-04-10"),
      dueDate: new Date("2026-05-10"),
      status: "paid",
      subtotal: 200000,
      taxAmount: 20000,
      total: 220000,
      note: "システム保守費 (4月分)",
      lines: [
        {
          description: "システム保守・監視",
          quantity: 1,
          unitPrice: 150000,
          taxRate: 0.1,
          amount: 150000,
        },
        {
          description: "軽微な修正対応",
          quantity: 2,
          unitPrice: 25000,
          taxRate: 0.1,
          amount: 50000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-008",
      customerName: "ゼータ映像制作",
      customerAddress: "東京都港区xxx-xxx",
      issueDate: new Date("2026-04-22"),
      dueDate: new Date("2026-05-22"),
      status: "issued",
      subtotal: 250000,
      taxAmount: 25000,
      total: 275000,
      note: "動画制作・編集費",
      lines: [
        {
          description: "動画撮影・ディレクション",
          quantity: 1,
          unitPrice: 120000,
          taxRate: 0.1,
          amount: 120000,
        },
        {
          description: "動画編集・カラーグレーディング",
          quantity: 1,
          unitPrice: 80000,
          taxRate: 0.1,
          amount: 80000,
        },
        {
          description: "BGM・音響編集",
          quantity: 1,
          unitPrice: 50000,
          taxRate: 0.1,
          amount: 50000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-009",
      customerName: "有限会社シータ",
      customerAddress: "大阪府大阪市xxx-xxx",
      issueDate: new Date("2026-05-09"),
      dueDate: new Date("2026-06-09"),
      status: "issued",
      subtotal: 180000,
      taxAmount: 18000,
      total: 198000,
      note: "UI/UXデザイン費",
      lines: [
        {
          description: "ユーザーリサーチ・IA設計",
          quantity: 1,
          unitPrice: 80000,
          taxRate: 0.1,
          amount: 80000,
        },
        {
          description: "UIデザイン (10画面)",
          quantity: 10,
          unitPrice: 10000,
          taxRate: 0.1,
          amount: 100000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-010",
      customerName: "株式会社ベータ",
      customerAddress: "東京都新宿区xxx-xxx",
      issueDate: new Date("2026-05-28"),
      dueDate: new Date("2026-06-28"),
      status: "issued",
      subtotal: 300000,
      taxAmount: 30000,
      total: 330000,
      note: "コンサルティング費 (5月分)",
      lines: [
        {
          description: "コンサルティング (15h)",
          quantity: 15,
          unitPrice: 20000,
          taxRate: 0.1,
          amount: 300000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-011",
      customerName: "株式会社アルファ",
      customerAddress: "東京都渋谷区xxx-xxx",
      issueDate: new Date("2026-06-05"),
      dueDate: new Date("2026-07-05"),
      status: "issued",
      subtotal: 200000,
      taxAmount: 20000,
      total: 220000,
      note: "システム保守費 (6月分)",
      lines: [
        {
          description: "システム保守・監視",
          quantity: 1,
          unitPrice: 150000,
          taxRate: 0.1,
          amount: 150000,
        },
        {
          description: "軽微な修正対応",
          quantity: 2,
          unitPrice: 25000,
          taxRate: 0.1,
          amount: 50000,
        },
      ],
    },
    {
      invoiceNumber: "INV-2026-012",
      customerName: "エータEC企画",
      customerAddress: "愛知県名古屋市xxx-xxx",
      issueDate: new Date("2026-06-20"),
      dueDate: new Date("2026-07-20"),
      status: "draft",
      subtotal: 800000,
      taxAmount: 80000,
      total: 880000,
      note: "ECサイト構築費",
      lines: [
        {
          description: "ECサイト要件定義・設計",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "フロントエンド実装",
          quantity: 1,
          unitPrice: 300000,
          taxRate: 0.1,
          amount: 300000,
        },
        {
          description: "バックエンド・API実装",
          quantity: 1,
          unitPrice: 200000,
          taxRate: 0.1,
          amount: 200000,
        },
        {
          description: "決済システム連携",
          quantity: 1,
          unitPrice: 100000,
          taxRate: 0.1,
          amount: 100000,
        },
      ],
    },
  ];

  for (const inv of INVOICES) {
    await prisma.invoice.create({
      data: {
        tenantId: tid,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        customerAddress: inv.customerAddress,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        total: inv.total,
        note: inv.note,
        lines: {
          create: inv.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            amount: l.amount,
          })),
        },
      },
    });
  }
  console.log(`  ✓ Created ${INVOICES.length} invoices`);

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 11. 法人モード デモデータ（株式会社テックソリューション）────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // 勘定科目 upsert（C プレフィックス = 法人専用）
  const corpAccs = await Promise.all([
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C4000" } },
      update: {},
      create: { tenantId: tid, code: "C4000", name: "売上高", category: "REVENUE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C4100" } },
      update: {},
      create: { tenantId: tid, code: "C4100", name: "役務収益", category: "REVENUE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C5000" } },
      update: {},
      create: { tenantId: tid, code: "C5000", name: "売上原価", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C5100" } },
      update: {},
      create: { tenantId: tid, code: "C5100", name: "外注費", category: "COGS" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7000" } },
      update: {},
      create: { tenantId: tid, code: "C7000", name: "人件費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7100" } },
      update: {},
      create: { tenantId: tid, code: "C7100", name: "地代家賃", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7200" } },
      update: {},
      create: { tenantId: tid, code: "C7200", name: "広告宣伝費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7300" } },
      update: {},
      create: { tenantId: tid, code: "C7300", name: "減価償却費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7400" } },
      update: {},
      create: { tenantId: tid, code: "C7400", name: "通信費", category: "EXPENSE" },
    }),
    prisma.account.upsert({
      where: { tenantId_code: { tenantId: tid, code: "C7500" } },
      update: {},
      create: { tenantId: tid, code: "C7500", name: "旅費交通費", category: "EXPENSE" },
    }),
  ]);
  const [cC4000, cC4100, cC5000, cC5100, cC7000, cC7100, cC7200, cC7300, cC7400, cC7500] = corpAccs;

  const corpDept = await prisma.department.upsert({
    where: { id: 3 },
    update: {},
    create: { id: 3, tenantId: tid, name: "本社" },
  });
  await prisma.department.upsert({
    where: { id: 4 },
    update: {},
    create: { id: 4, tenantId: tid, name: "営業部", parentId: 3 },
  });
  await prisma.department.upsert({
    where: { id: 5 },
    update: {},
    create: { id: 5, tenantId: tid, name: "開発部", parentId: 3 },
  });

  // 月次売上（季節変動あり）
  const CORP_REV_BASE: Record<number, number> = {
    2023: 3_000_000,
    2024: 4_000_000,
    2025: 5_000_000,
    2026: 5_500_000,
  };
  const CORP_REV_FACTORS = [0.9, 0.8, 1.05, 1.1, 1.0, 1.1, 0.85, 0.75, 1.1, 1.05, 1.0, 1.0];
  // 役務収益は売上の15-25%
  const CORP_SVC_RATIO = [0.2, 0.22, 0.18, 0.15, 0.2, 0.18, 0.25, 0.22, 0.17, 0.18, 0.2, 0.2];

  // COGS・販管費の年次水準
  const CORP_COGS_BASE: Record<number, [number, number]> = {
    2023: [400_000, 250_000], // 売上原価, 外注費
    2024: [500_000, 300_000],
    2025: [600_000, 400_000],
    2026: [700_000, 450_000],
  };
  const CORP_PAYROLL: Record<number, number> = {
    2023: 1_500_000,
    2024: 2_000_000,
    2025: 2_500_000,
    2026: 2_700_000,
  };
  const CORP_FIXED_EXPENSE = [
    { id: () => cC7100.id, amount: 200_000 }, // 地代家賃（全年固定）
    { id: () => cC7300.id, amount: 100_000 }, // 減価償却費
    { id: () => cC7400.id, amount: 80_000 }, // 通信費
  ];

  for (const [yearStr, base] of Object.entries(CORP_REV_BASE)) {
    const year = Number(yearStr);
    const maxMonth = year === 2026 ? 6 : 12;
    const [cogsBase, subBase] = CORP_COGS_BASE[year] ?? [500_000, 300_000];
    const payroll = CORP_PAYROLL[year] ?? 2_500_000;
    const advBudget = year >= 2025 ? 200_000 : 150_000;
    const travelBudget = year >= 2024 ? 120_000 : 80_000;

    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      const rev = Math.round(base * CORP_REV_FACTORS[i]);
      const svcRev = Math.round(rev * CORP_SVC_RATIO[i]);
      const cogs = Math.round(cogsBase * (0.9 + Math.random() * 0.2));
      const sub = Math.round(subBase * (0.9 + Math.random() * 0.2));

      await prisma.financialRecord.createMany({
        data: [
          { accountId: cC4000.id, departmentId: corpDept.id, periodId: p.id, amount: rev - svcRev },
          { accountId: cC4100.id, departmentId: corpDept.id, periodId: p.id, amount: svcRev },
          { accountId: cC5000.id, departmentId: corpDept.id, periodId: p.id, amount: cogs },
          { accountId: cC5100.id, departmentId: corpDept.id, periodId: p.id, amount: sub },
          { accountId: cC7000.id, departmentId: corpDept.id, periodId: p.id, amount: payroll },
          { accountId: cC7200.id, departmentId: corpDept.id, periodId: p.id, amount: advBudget },
          { accountId: cC7500.id, departmentId: corpDept.id, periodId: p.id, amount: travelBudget },
          ...CORP_FIXED_EXPENSE.map((e) => ({
            accountId: e.id(),
            departmentId: corpDept.id,
            periodId: p.id,
            amount: e.amount,
          })),
        ].map((r) => ({ ...r, tenantId: tid })),
      });
    }
  }
  console.log("  ✓ Created corporate financial records");

  // 予算（法人）
  for (const year of [2023, 2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 6 : 12;
    const revTarget = CORP_REV_BASE[year] ?? 5_000_000;
    const [cogsTarget, subTarget] = CORP_COGS_BASE[year] ?? [500_000, 300_000];
    const payroll = CORP_PAYROLL[year] ?? 2_500_000;
    const adv = year >= 2025 ? 200_000 : 150_000;
    const travel = year >= 2024 ? 120_000 : 80_000;

    const corpBudgetDef: [number, number][] = [
      [cC4000.id, Math.round(revTarget * 0.82)],
      [cC4100.id, Math.round(revTarget * 0.18)],
      [cC5000.id, cogsTarget],
      [cC5100.id, subTarget],
      [cC7000.id, payroll],
      [cC7100.id, 200_000],
      [cC7200.id, adv],
      [cC7300.id, 100_000],
      [cC7400.id, 80_000],
      [cC7500.id, travel],
    ];

    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      for (const [accId, amount] of corpBudgetDef) {
        await prisma.budget.upsert({
          where: {
            tenantId_accountId_periodId: { tenantId: tid, accountId: accId, periodId: p.id },
          },
          update: { amount },
          create: { tenantId: tid, accountId: accId, periodId: p.id, amount },
        });
      }
    }
  }
  console.log("  ✓ Created corporate budgets");

  // 銀行口座（法人）
  const corpMainAcc = await prisma.bankAccount.upsert({
    where: { id: 6 },
    update: {},
    create: {
      id: 6,
      tenantId: tid,
      name: "法人普通預金",
      bankName: "三菱UFJ銀行",
      branchName: "新宿法人営業部",
      role: "SALARY",
    },
  });
  const corpSavingsAcc = await prisma.bankAccount.upsert({
    where: { id: 7 },
    update: {},
    create: {
      id: 7,
      tenantId: tid,
      name: "法人積立口座",
      bankName: "住信SBIネット銀行",
      role: "SAVINGS",
    },
  });

  const corpTxnCount = await prisma.bankTransaction.count({ where: { accountId: { in: [6, 7] } } });
  if (corpTxnCount === 0) {
    const corpMainTxns = [
      { date: "2026-04-05", description: "X社 売掛入金", amount: 3_200_000, balance: 12_800_000 },
      { date: "2026-04-10", description: "Y社 売掛入金", amount: 1_500_000, balance: 14_300_000 },
      {
        date: "2026-04-25",
        description: "給与・賞与 支払",
        amount: -2_700_000,
        balance: 11_600_000,
      },
      {
        date: "2026-04-28",
        description: "地代家賃 口座振替",
        amount: -200_000,
        balance: 11_400_000,
      },
      {
        date: "2026-04-28",
        description: "通信費・クラウド費 口座振替",
        amount: -80_000,
        balance: 11_320_000,
      },
      {
        date: "2026-04-30",
        description: "外注費 A社支払い",
        amount: -450_000,
        balance: 10_870_000,
      },
      { date: "2026-04-30", description: "積立口座 振替", amount: -500_000, balance: 10_370_000 },
      { date: "2026-05-08", description: "X社 売掛入金", amount: 3_800_000, balance: 14_170_000 },
      { date: "2026-05-15", description: "Z社 役務収益", amount: 1_100_000, balance: 15_270_000 },
      {
        date: "2026-05-25",
        description: "給与・賞与 支払",
        amount: -2_700_000,
        balance: 12_570_000,
      },
      {
        date: "2026-05-28",
        description: "地代家賃 口座振替",
        amount: -200_000,
        balance: 12_370_000,
      },
      {
        date: "2026-05-28",
        description: "外注費 A社支払い",
        amount: -480_000,
        balance: 11_890_000,
      },
      { date: "2026-05-30", description: "広告宣伝費 支払", amount: -200_000, balance: 11_690_000 },
      { date: "2026-05-30", description: "積立口座 振替", amount: -500_000, balance: 11_190_000 },
      { date: "2026-06-05", description: "X社 売掛入金", amount: 3_500_000, balance: 14_690_000 },
      { date: "2026-06-12", description: "Y社 売掛入金", amount: 1_800_000, balance: 16_490_000 },
      {
        date: "2026-06-25",
        description: "給与・賞与 支払",
        amount: -2_700_000,
        balance: 13_790_000,
      },
      {
        date: "2026-06-28",
        description: "地代家賃 口座振替",
        amount: -200_000,
        balance: 13_590_000,
      },
      {
        date: "2026-06-28",
        description: "外注費 A社支払い",
        amount: -420_000,
        balance: 13_170_000,
      },
      { date: "2026-06-30", description: "積立口座 振替", amount: -500_000, balance: 12_670_000 },
    ];
    const corpSavingsTxns = [
      {
        date: "2026-04-30",
        description: "法人普通預金 振替入金",
        amount: 500_000,
        balance: 5_500_000,
      },
      {
        date: "2026-05-30",
        description: "法人普通預金 振替入金",
        amount: 500_000,
        balance: 6_000_000,
      },
      {
        date: "2026-06-30",
        description: "法人普通預金 振替入金",
        amount: 500_000,
        balance: 6_500_000,
      },
    ];
    for (const t of corpMainTxns) {
      await prisma.bankTransaction.create({
        data: {
          accountId: corpMainAcc.id,
          date: new Date(t.date),
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          source: "MANUAL",
        },
      });
    }
    for (const t of corpSavingsTxns) {
      await prisma.bankTransaction.create({
        data: {
          accountId: corpSavingsAcc.id,
          date: new Date(t.date),
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          source: "MANUAL",
        },
      });
    }
    console.log("  ✓ Created corporate bank transactions");
  }

  // 役員
  await prisma.officer.createMany({
    data: [
      {
        tenantId: tid,
        name: "田中 一郎",
        title: "代表取締役",
        termStart: new Date("2024-06-01"),
        termEnd: new Date("2026-05-31"),
        salary: 1_200_000,
      },
      {
        tenantId: tid,
        name: "鈴木 花子",
        title: "取締役 CFO",
        termStart: new Date("2024-06-01"),
        termEnd: new Date("2026-05-31"),
        salary: 900_000,
      },
      {
        tenantId: tid,
        name: "佐藤 次郎",
        title: "取締役 CTO",
        termStart: new Date("2024-06-01"),
        termEnd: new Date("2026-05-31"),
        salary: 950_000,
      },
      {
        tenantId: tid,
        name: "山田 三郎",
        title: "監査役",
        termStart: new Date("2024-06-01"),
        termEnd: new Date("2027-05-31"),
        salary: null,
      },
    ],
  });
  console.log("  ✓ Created corporate tenant & officers");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 12. 借入金 + 返済履歴 ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.loanRepayment.deleteMany({});
  await prisma.loan.deleteMany({});

  const loan1 = await prisma.loan.create({
    data: {
      tenantId: tid,
      lenderName: "三井住友銀行",
      amount: 3_000_000,
      interestRate: 0.015,
      borrowedOn: new Date("2024-04-01"),
      repaymentDate: new Date("2027-03-31"),
      remainingAmount: 1_800_000,
      status: "active",
      note: "事業資金（設備投資）",
    },
  });
  const loan2 = await prisma.loan.create({
    data: {
      tenantId: tid,
      lenderName: "日本政策金融公庫",
      amount: 5_000_000,
      interestRate: 0.01,
      borrowedOn: new Date("2023-10-01"),
      repaymentDate: new Date("2028-09-30"),
      remainingAmount: 3_500_000,
      status: "active",
      note: "創業融資",
    },
  });
  const loan3 = await prisma.loan.create({
    data: {
      tenantId: tid,
      lenderName: "みずほ銀行",
      amount: 1_000_000,
      interestRate: 0.02,
      borrowedOn: new Date("2022-06-01"),
      repaymentDate: new Date("2025-05-31"),
      remainingAmount: 0,
      status: "repaid",
      note: "短期運転資金",
    },
  });
  // 住宅ローン: 家賃（H3000）に月々の返済額を自動反映
  const loan4 = await prisma.loan.create({
    data: {
      tenantId: tid,
      lenderName: "住宅金融支援機構",
      amount: 30_000_000,
      interestRate: 0.008,
      borrowedOn: new Date("2020-04-01"),
      repaymentDate: new Date("2050-03-31"),
      remainingAmount: 26_000_000,
      status: "active",
      note: "住宅ローン（自宅マンション購入）",
      loanType: "housing",
      linkedAccountId: h3000.id,
      monthlyPayment: 89_000,
    },
  });
  // 返済履歴（loan1: 月8万、loan2: 月10万、loan3: 完済）
  const loan1Repayments = [
    { repaidOn: "2024-05-01", principal: 75000, interest: 3750 },
    { repaidOn: "2024-06-01", principal: 75000, interest: 3656 },
    { repaidOn: "2024-07-01", principal: 75000, interest: 3563 },
    { repaidOn: "2024-08-01", principal: 75000, interest: 3469 },
    { repaidOn: "2024-09-01", principal: 75000, interest: 3375 },
    { repaidOn: "2024-10-01", principal: 75000, interest: 3281 },
    { repaidOn: "2024-11-01", principal: 75000, interest: 3188 },
    { repaidOn: "2024-12-01", principal: 75000, interest: 3094 },
    { repaidOn: "2025-01-01", principal: 75000, interest: 3000 },
    { repaidOn: "2025-02-01", principal: 75000, interest: 2906 },
    { repaidOn: "2025-03-01", principal: 75000, interest: 2813 },
    { repaidOn: "2025-04-01", principal: 75000, interest: 2719 },
    { repaidOn: "2025-05-01", principal: 75000, interest: 2625 },
    { repaidOn: "2025-06-01", principal: 75000, interest: 2531 },
    { repaidOn: "2025-07-01", principal: 75000, interest: 2438 },
    { repaidOn: "2025-08-01", principal: 75000, interest: 2344 },
  ];
  for (const r of loan1Repayments) {
    await prisma.loanRepayment.create({
      data: {
        loanId: loan1.id,
        repaidOn: new Date(r.repaidOn),
        principal: r.principal,
        interest: r.interest,
        totalAmount: r.principal + r.interest,
      },
    });
  }
  const loan2Repayments = [
    { repaidOn: "2023-11-01", principal: 83000, interest: 4167 },
    { repaidOn: "2023-12-01", principal: 83000, interest: 4098 },
    { repaidOn: "2024-01-01", principal: 83000, interest: 4029 },
    { repaidOn: "2024-02-01", principal: 83000, interest: 3960 },
    { repaidOn: "2024-03-01", principal: 83000, interest: 3891 },
    { repaidOn: "2024-04-01", principal: 83000, interest: 3822 },
    { repaidOn: "2024-05-01", principal: 83000, interest: 3753 },
    { repaidOn: "2024-06-01", principal: 83000, interest: 3684 },
    { repaidOn: "2024-07-01", principal: 83000, interest: 3614 },
    { repaidOn: "2024-08-01", principal: 83000, interest: 3545 },
    { repaidOn: "2024-09-01", principal: 83000, interest: 3476 },
    { repaidOn: "2024-10-01", principal: 83000, interest: 3407 },
    { repaidOn: "2024-11-01", principal: 83000, interest: 3338 },
    { repaidOn: "2024-12-01", principal: 83000, interest: 3269 },
    { repaidOn: "2025-01-01", principal: 83000, interest: 3200 },
    { repaidOn: "2025-02-01", principal: 83000, interest: 3131 },
    { repaidOn: "2025-03-01", principal: 83000, interest: 3062 },
    { repaidOn: "2025-04-01", principal: 83000, interest: 2993 },
    { repaidOn: "2025-05-01", principal: 83000, interest: 2924 },
    { repaidOn: "2025-06-01", principal: 83000, interest: 2855 },
  ];
  for (const r of loan2Repayments) {
    await prisma.loanRepayment.create({
      data: {
        loanId: loan2.id,
        repaidOn: new Date(r.repaidOn),
        principal: r.principal,
        interest: r.interest,
        totalAmount: r.principal + r.interest,
      },
    });
  }
  // loan3 完済履歴（3年間、月1万弱）
  for (let m = 0; m < 36; m++) {
    const d = new Date("2022-07-01");
    d.setMonth(d.getMonth() + m);
    await prisma.loanRepayment.create({
      data: {
        loanId: loan3.id,
        repaidOn: d,
        principal: 27000,
        interest: Math.max(100, 1667 - m * 45),
        totalAmount: 27000 + Math.max(100, 1667 - m * 45),
      },
    });
  }
  // loan4（住宅ローン）返済履歴（2020-04〜直近、月8.9万）
  for (let m = 0; m < 24; m++) {
    const d = new Date("2024-08-01");
    d.setMonth(d.getMonth() + m);
    await prisma.loanRepayment.create({
      data: {
        loanId: loan4.id,
        repaidOn: d,
        principal: 71_000,
        interest: 18_000,
        totalAmount: 89_000,
      },
    });
  }
  console.log("  ✓ Created loans & repayments");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 13. 売掛金・買掛金 ───────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.receivable.deleteMany({});
  await prisma.payable.deleteMany({});

  await prisma.receivable.createMany({
    data: [
      {
        customerName: "株式会社アルファ",
        description: "Webサイト制作費 (4月分)",
        amount: 550000,
        taxAmount: 50000,
        issueDate: new Date("2026-04-10"),
        dueDate: new Date("2026-05-10"),
        status: "paid",
        paidOn: new Date("2026-05-08"),
        paidAmount: 550000,
        invoiceNumber: "INV-2026-007",
      },
      {
        customerName: "ゼータ映像制作",
        description: "動画制作・編集費",
        amount: 275000,
        taxAmount: 25000,
        issueDate: new Date("2026-04-22"),
        dueDate: new Date("2026-05-22"),
        status: "paid",
        paidOn: new Date("2026-05-20"),
        paidAmount: 275000,
        invoiceNumber: "INV-2026-008",
      },
      {
        customerName: "有限会社シータ",
        description: "UI/UXデザイン費",
        amount: 198000,
        taxAmount: 18000,
        issueDate: new Date("2026-05-09"),
        dueDate: new Date("2026-06-09"),
        status: "open",
        invoiceNumber: "INV-2026-009",
      },
      {
        customerName: "株式会社ベータ",
        description: "コンサルティング費 (5月分)",
        amount: 330000,
        taxAmount: 30000,
        issueDate: new Date("2026-05-28"),
        dueDate: new Date("2026-06-28"),
        status: "open",
        invoiceNumber: "INV-2026-010",
      },
      {
        customerName: "株式会社アルファ",
        description: "システム保守費 (6月分)",
        amount: 220000,
        taxAmount: 20000,
        issueDate: new Date("2026-06-05"),
        dueDate: new Date("2026-07-05"),
        status: "open",
        invoiceNumber: "INV-2026-011",
      },
      {
        customerName: "エータEC企画",
        description: "ECサイト構築費",
        amount: 880000,
        taxAmount: 80000,
        issueDate: new Date("2026-06-20"),
        dueDate: new Date("2026-07-20"),
        status: "open",
        invoiceNumber: "INV-2026-012",
        note: "着手金50%受領済み",
      },
    ].map((r) => ({ ...r, tenantId: tid })),
  });

  await prisma.payable.createMany({
    data: [
      {
        supplierName: "田中エンジニアリング",
        description: "外注エンジニア費 (4月分)",
        amount: 220000,
        taxAmount: 20000,
        issueDate: new Date("2026-04-30"),
        dueDate: new Date("2026-05-31"),
        status: "paid",
        paidOn: new Date("2026-05-25"),
        paidAmount: 220000,
      },
      {
        supplierName: "佐藤デザイン事務所",
        description: "外注デザイン費 (4月分)",
        amount: 88000,
        taxAmount: 8000,
        issueDate: new Date("2026-04-30"),
        dueDate: new Date("2026-05-31"),
        status: "paid",
        paidOn: new Date("2026-05-20"),
        paidAmount: 88000,
      },
      {
        supplierName: "田中エンジニアリング",
        description: "外注エンジニア費 (5月分)",
        amount: 220000,
        taxAmount: 20000,
        issueDate: new Date("2026-05-31"),
        dueDate: new Date("2026-06-30"),
        status: "open",
      },
      {
        supplierName: "AWSジャパン",
        description: "クラウド利用料 (6月分)",
        amount: 33000,
        taxAmount: 3000,
        issueDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-30"),
        status: "open",
      },
      {
        supplierName: "○○不動産",
        description: "事務所家賃 (7月分)",
        amount: 150000,
        taxAmount: 0,
        issueDate: new Date("2026-06-25"),
        dueDate: new Date("2026-07-01"),
        status: "open",
      },
    ].map((r) => ({ ...r, tenantId: tid })),
  });
  console.log("  ✓ Created receivables & payables");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 14. 固定資産 + 減価償却 ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.depreciation.deleteMany({});
  await prisma.fixedAsset.deleteMany({});

  const fa1 = await prisma.fixedAsset.create({
    data: {
      tenantId: tid,
      name: "MacBook Pro 14インチ",
      category: "tangible",
      acquiredOn: new Date("2024-01-10"),
      acquisitionCost: 248000,
      usefulLife: 4,
      method: "straight",
      residualRate: 0.1,
      bookValue: 124000,
    },
  });
  const fa2 = await prisma.fixedAsset.create({
    data: {
      tenantId: tid,
      name: "業務用デスク・チェアセット",
      category: "tangible",
      acquiredOn: new Date("2023-06-01"),
      acquisitionCost: 180000,
      usefulLife: 8,
      method: "straight",
      residualRate: 0.1,
      bookValue: 135000,
    },
  });
  const fa3 = await prisma.fixedAsset.create({
    data: {
      tenantId: tid,
      name: "Adobe Creative Cloud (年間)",
      category: "intangible",
      acquiredOn: new Date("2025-04-01"),
      acquisitionCost: 72000,
      usefulLife: 3,
      method: "straight",
      residualRate: 0.0,
      bookValue: 48000,
    },
  });
  const fa4 = await prisma.fixedAsset.create({
    data: {
      tenantId: tid,
      name: "法人用ノートPC（開発機）",
      category: "tangible",
      acquiredOn: new Date("2023-09-01"),
      acquisitionCost: 320000,
      usefulLife: 4,
      method: "straight",
      residualRate: 0.1,
      bookValue: 120000,
    },
  });
  await prisma.depreciation.createMany({
    data: [
      { fixedAssetId: fa1.id, fiscalYear: 2024, amount: 55800 },
      { fixedAssetId: fa1.id, fiscalYear: 2025, amount: 55800 },
      { fixedAssetId: fa2.id, fiscalYear: 2023, amount: 20250 },
      { fixedAssetId: fa2.id, fiscalYear: 2024, amount: 20250 },
      { fixedAssetId: fa2.id, fiscalYear: 2025, amount: 20250 },
      { fixedAssetId: fa3.id, fiscalYear: 2025, amount: 24000 },
      { fixedAssetId: fa4.id, fiscalYear: 2023, amount: 72000 },
      { fixedAssetId: fa4.id, fiscalYear: 2024, amount: 72000 },
      { fixedAssetId: fa4.id, fiscalYear: 2025, amount: 72000 },
    ],
  });
  console.log("  ✓ Created fixed assets & depreciations");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 15. 棚卸 ────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.inventoryItem.deleteMany({});
  await prisma.inventory.deleteMany({});

  const inv1 = await prisma.inventory.create({
    data: {
      tenantId: tid,
      name: "2025年12月末棚卸",
      inventoryDate: new Date("2025-12-31"),
      status: "closed",
      totalAmount: 485000,
      valuationMethod: "last_purchase",
    },
  });
  const inv2 = await prisma.inventory.create({
    data: {
      tenantId: tid,
      name: "2026年6月末棚卸",
      inventoryDate: new Date("2026-06-30"),
      status: "open",
      totalAmount: 312000,
      valuationMethod: "last_purchase",
    },
  });
  await prisma.inventoryItem.createMany({
    data: [
      {
        inventoryId: inv1.id,
        itemName: "デザインテンプレートパック",
        itemType: "goods",
        quantity: 50,
        unit: "点",
        unitPrice: 3000,
        totalAmount: 150000,
      },
      {
        inventoryId: inv1.id,
        itemName: "プリンター用紙A4 (500枚)",
        itemType: "material",
        quantity: 20,
        unit: "束",
        unitPrice: 1500,
        totalAmount: 30000,
      },
      {
        inventoryId: inv1.id,
        itemName: "会社ロゴ入り名刺",
        itemType: "goods",
        quantity: 500,
        unit: "枚",
        unitPrice: 50,
        totalAmount: 25000,
      },
      {
        inventoryId: inv1.id,
        itemName: "外付けSSD 1TB",
        itemType: "goods",
        quantity: 3,
        unit: "個",
        unitPrice: 15000,
        totalAmount: 45000,
      },
      {
        inventoryId: inv1.id,
        itemName: "オリジナルWordPressテーマ",
        itemType: "product",
        quantity: 1,
        unit: "式",
        unitPrice: 235000,
        totalAmount: 235000,
      },
      {
        inventoryId: inv2.id,
        itemName: "デザインテンプレートパック",
        itemType: "goods",
        quantity: 30,
        unit: "点",
        unitPrice: 3000,
        totalAmount: 90000,
      },
      {
        inventoryId: inv2.id,
        itemName: "プリンター用紙A4 (500枚)",
        itemType: "material",
        quantity: 10,
        unit: "束",
        unitPrice: 1500,
        totalAmount: 15000,
      },
      {
        inventoryId: inv2.id,
        itemName: "外付けSSD 1TB",
        itemType: "goods",
        quantity: 5,
        unit: "個",
        unitPrice: 15000,
        totalAmount: 75000,
      },
      {
        inventoryId: inv2.id,
        itemName: "WordPressプラグインライセンス",
        itemType: "product",
        quantity: 12,
        unit: "本",
        unitPrice: 11000,
        totalAmount: 132000,
      },
    ],
  });
  console.log("  ✓ Created inventories");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 16. 家事按分 ─────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.apportionment.deleteMany({});

  const [a7000, a7500, a7100, aH3100, aH3200] = await Promise.all([
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7500" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7100" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "H3100" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "H3200" } } }),
  ]);
  if (a7000 && a7500 && a7100 && aH3100 && aH3200) {
    await prisma.apportionment.createMany({
      data: [
        {
          accountId: a7500.id,
          businessRate: 50,
          description: "自宅兼事務所（居室の50%を事業利用）",
        },
        { accountId: aH3100.id, businessRate: 30, description: "電気代（事業利用30%）" },
        {
          accountId: aH3200.id,
          businessRate: 60,
          description: "通信費（スマホ・ネット、事業利用60%）",
        },
        { accountId: a7000.id, businessRate: 80, description: "インターネット回線（事業利用80%）" },
        { accountId: a7100.id, businessRate: 70, description: "消耗品（文具等、事業利用70%）" },
      ].map((r) => ({ ...r, tenantId: tid })),
    });
  }
  console.log("  ✓ Created apportionments");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 17. 仕訳テンプレート ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.journalTemplateLine.deleteMany({});
  await prisma.journalTemplate.deleteMany({});

  const [t4000, t1100, t5000, t7500, t7000, t7100, t7400, t3100] = await Promise.all([
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "4000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "1100" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "5000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7500" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7100" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7400" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "3100" } } }),
  ]);
  if (t4000 && t1100 && t5000 && t7500 && t7000 && t7100 && t7400 && t3100) {
    const tmpl1 = await prisma.journalTemplate.create({
      data: {
        tenantId: tid,
        name: "売上入金（普通預金）",
        description: "売上を普通預金で受け取る場合の定型仕訳",
      },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl1.id,
          side: "debit",
          accountId: t1100.id,
          amount: null,
          note: "入金額（税込）",
          sortOrder: 1,
        },
        {
          templateId: tmpl1.id,
          side: "credit",
          accountId: t4000.id,
          amount: null,
          note: "売上（税抜）",
          sortOrder: 2,
        },
        {
          templateId: tmpl1.id,
          side: "credit",
          accountId: t3100.id,
          amount: null,
          note: "消費税",
          sortOrder: 3,
        },
      ],
    });

    const tmpl2 = await prisma.journalTemplate.create({
      data: { tenantId: tid, name: "外注費支払い", description: "外注先への振込時の定型仕訳" },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl2.id,
          side: "debit",
          accountId: t5000.id,
          amount: null,
          note: "外注費（税抜）",
          sortOrder: 1,
        },
        {
          templateId: tmpl2.id,
          side: "debit",
          accountId: t3100.id,
          amount: null,
          note: "消費税",
          sortOrder: 2,
        },
        {
          templateId: tmpl2.id,
          side: "credit",
          accountId: t1100.id,
          amount: null,
          note: "支払額（税込）",
          sortOrder: 3,
        },
      ],
    });

    const tmpl3 = await prisma.journalTemplate.create({
      data: { tenantId: tid, name: "家賃支払い（非課税）", description: "毎月の事務所家賃支払い" },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl3.id,
          side: "debit",
          accountId: t7500.id,
          amount: 150000,
          note: "地代家賃",
          sortOrder: 1,
        },
        {
          templateId: tmpl3.id,
          side: "credit",
          accountId: t1100.id,
          amount: 150000,
          note: "普通預金",
          sortOrder: 2,
        },
      ],
    });

    const tmpl4 = await prisma.journalTemplate.create({
      data: {
        tenantId: tid,
        name: "クラウドサービス料（通信費）",
        description: "AWS・各種SaaSの月額費用",
      },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl4.id,
          side: "debit",
          accountId: t7000.id,
          amount: null,
          note: "通信費（税抜）",
          sortOrder: 1,
        },
        {
          templateId: tmpl4.id,
          side: "debit",
          accountId: t3100.id,
          amount: null,
          note: "消費税",
          sortOrder: 2,
        },
        {
          templateId: tmpl4.id,
          side: "credit",
          accountId: t1100.id,
          amount: null,
          note: "支払額（税込）",
          sortOrder: 3,
        },
      ],
    });

    const tmpl5 = await prisma.journalTemplate.create({
      data: {
        tenantId: tid,
        name: "消耗品購入（カード払い）",
        description: "事業用消耗品のクレジットカード払い",
      },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl5.id,
          side: "debit",
          accountId: t7100.id,
          amount: null,
          note: "消耗品費（税抜）",
          sortOrder: 1,
        },
        {
          templateId: tmpl5.id,
          side: "debit",
          accountId: t3100.id,
          amount: null,
          note: "消費税",
          sortOrder: 2,
        },
        {
          templateId: tmpl5.id,
          side: "credit",
          accountId: t3100.id,
          amount: null,
          note: "未払金（カード）",
          sortOrder: 3,
        },
      ],
    });

    const tmpl6 = await prisma.journalTemplate.create({
      data: {
        tenantId: tid,
        name: "会議費（現金払い）",
        description: "打ち合わせ時の飲食・会議費用",
      },
    });
    await prisma.journalTemplateLine.createMany({
      data: [
        {
          templateId: tmpl6.id,
          side: "debit",
          accountId: t7400.id,
          amount: null,
          note: "会議費（税抜）",
          sortOrder: 1,
        },
        {
          templateId: tmpl6.id,
          side: "debit",
          accountId: t3100.id,
          amount: null,
          note: "消費税",
          sortOrder: 2,
        },
        {
          templateId: tmpl6.id,
          side: "credit",
          accountId: t1100.id,
          amount: null,
          note: "現金",
          sortOrder: 3,
        },
      ],
    });
  }
  console.log("  ✓ Created journal templates");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 18. 会計年度 ─────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.fiscalYear.deleteMany({});

  await prisma.fiscalYear.createMany({
    data: [
      {
        tenantId: tid,
        year: 2023,
        startDate: new Date("2023-04-01"),
        endDate: new Date("2024-03-31"),
        status: "closed",
      },
      {
        tenantId: tid,
        year: 2024,
        startDate: new Date("2024-04-01"),
        endDate: new Date("2025-03-31"),
        status: "closed",
      },
      {
        tenantId: tid,
        year: 2025,
        startDate: new Date("2025-04-01"),
        endDate: new Date("2026-03-31"),
        status: "closed",
      },
      {
        tenantId: tid,
        year: 2026,
        startDate: new Date("2026-04-01"),
        endDate: new Date("2027-03-31"),
        status: "open",
      },
    ],
  });
  console.log("  ✓ Created fiscal years");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 19. 事業者情報（個人）・消費税設定 ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.taxSetting.deleteMany({});
  await prisma.businessProfile.deleteMany({});

  await prisma.businessProfile.create({
    data: {
      tenantId: tid,
      tradeName: "田中 太郎 Web制作事務所",
      ownerName: "田中 太郎",
      openedOn: new Date("2020-04-01"),
      blueReturn: true,
      invoiceNumber: "T1234567890123",
      taxationType: "general",
    },
  });
  await prisma.taxSetting.createMany({
    data: [
      { tenantId: tid, taxYear: 2023, taxationType: "general" },
      { tenantId: tid, taxYear: 2024, taxationType: "general" },
      { tenantId: tid, taxYear: 2025, taxationType: "general" },
      { tenantId: tid, taxYear: 2026, taxationType: "general" },
    ],
  });
  console.log("  ✓ Created business profile & tax settings");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 20. 外部サービス連携 ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.linkedAccount.deleteMany({});

  const [laAsset, laLiab] = await Promise.all([
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "1100" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "3100" } } }),
  ]);
  await prisma.linkedAccount.createMany({
    data: [
      {
        name: "三井住友銀行 事業用口座",
        type: "BANK",
        institution: "三井住友銀行",
        lastFour: "1234",
        accountId: laAsset?.id,
        note: "メイン事業口座",
      },
      {
        name: "ゆうちょ銀行 納税積立",
        type: "BANK",
        institution: "ゆうちょ銀行",
        lastFour: "5678",
        accountId: laAsset?.id,
        note: "税金積立専用",
      },
      {
        name: "三井住友VISAカード",
        type: "CREDIT_CARD",
        institution: "三井住友カード",
        lastFour: "9012",
        accountId: laLiab?.id,
        note: "事業用クレカ",
      },
      {
        name: "Amazon Business",
        type: "CREDIT_CARD",
        institution: "Amazon",
        lastFour: "3456",
        accountId: laLiab?.id,
        note: "EC・消耗品購入用",
      },
    ].map((r) => ({ ...r, tenantId: tid })),
  });
  console.log("  ✓ Created linked accounts");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 21. 決算整理仕訳（未収収益・未払費用）───────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.accruedExpense.deleteMany({});
  await prisma.accruedRevenue.deleteMany({});

  const [ar4000, ae7500, ae7000, ae7700] = await Promise.all([
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "4000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7500" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7000" } } }),
    prisma.account.findUnique({ where: { tenantId_code: { tenantId: tid, code: "7700" } } }),
  ]);
  if (ar4000 && ae7500 && ae7000 && ae7700) {
    await prisma.accruedRevenue.createMany({
      data: [
        {
          description: "A社 保守費用 未収計上（3月分→4月入金）",
          amount: 200000,
          accrualDate: new Date("2025-03-31"),
          accountId: ar4000.id,
          fiscalYear: 2025,
          status: "posted",
        },
        {
          description: "B社 コンサル料 未収計上（3月分→4月入金）",
          amount: 300000,
          accrualDate: new Date("2025-03-31"),
          accountId: ar4000.id,
          fiscalYear: 2025,
          status: "posted",
        },
        {
          description: "E社 SNS運用代行 未収計上（3月分→4月入金）",
          amount: 120000,
          accrualDate: new Date("2025-03-31"),
          accountId: ar4000.id,
          fiscalYear: 2025,
          status: "posted",
        },
        {
          description: "A社 保守費用 未収計上（12月分→1月入金）",
          amount: 200000,
          accrualDate: new Date("2025-12-31"),
          accountId: ar4000.id,
          fiscalYear: 2025,
          status: "pending",
        },
      ].map((r) => ({ ...r, tenantId: tid })),
    });
    await prisma.accruedExpense.createMany({
      data: [
        {
          description: "家賃 未払計上（3月分→4月引落）",
          amount: 150000,
          accrualDate: new Date("2025-03-31"),
          accountId: ae7500.id,
          fiscalYear: 2025,
          status: "posted",
        },
        {
          description: "クラウドサービス料 未払計上（3月分）",
          amount: 30000,
          accrualDate: new Date("2025-03-31"),
          accountId: ae7000.id,
          fiscalYear: 2025,
          status: "posted",
        },
        {
          description: "家賃 未払計上（12月分→1月引落）",
          amount: 150000,
          accrualDate: new Date("2025-12-31"),
          accountId: ae7500.id,
          fiscalYear: 2025,
          status: "pending",
        },
        {
          description: "外注エンジニア費 未払計上（12月分）",
          amount: 200000,
          accrualDate: new Date("2025-12-31"),
          accountId: ae7700.id,
          fiscalYear: 2025,
          status: "pending",
        },
      ].map((r) => ({ ...r, tenantId: tid })),
    });
  }
  console.log("  ✓ Created accrued revenues & expenses");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 22. ガバナンス（株主総会・配当）─────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.dividend.deleteMany({});
  await prisma.shareholderMeeting.deleteMany({});

  await prisma.shareholderMeeting.createMany({
    data: [
      {
        tenantId: tid,
        meetingDate: new Date("2023-06-25"),
        meetingType: "regular",
        agenda: "第5期 決算承認・役員改選・配当決議",
        resolution: "議案全て承認可決。配当金 1株あたり500円。役員全員再任。",
      },
      {
        tenantId: tid,
        meetingDate: new Date("2024-06-23"),
        meetingType: "regular",
        agenda: "第6期 決算承認・役員改選・中期経営計画審議",
        resolution: "議案全て承認可決。配当金 1株あたり600円。役員全員再任。",
      },
      {
        tenantId: tid,
        meetingDate: new Date("2025-06-22"),
        meetingType: "regular",
        agenda: "第7期 決算承認・役員報酬改定・配当決議",
        resolution: "議案全て承認可決。配当金 1株あたり700円。代表取締役報酬を月額120万に改定。",
      },
      {
        tenantId: tid,
        meetingDate: new Date("2024-11-15"),
        meetingType: "extraordinary",
        agenda: "第三者割当増資の承認",
        resolution: "新株発行（1,000株、1株10,000円）承認可決。調達額1,000万円を設備投資に充当。",
      },
    ],
  });
  await prisma.dividend.createMany({
    data: [
      {
        tenantId: tid,
        resolutionDate: new Date("2023-06-25"),
        paymentDate: new Date("2023-08-31"),
        perShareAmount: 500,
        totalAmount: 500000,
      },
      {
        tenantId: tid,
        resolutionDate: new Date("2024-06-23"),
        paymentDate: new Date("2024-08-31"),
        perShareAmount: 600,
        totalAmount: 600000,
      },
      {
        tenantId: tid,
        resolutionDate: new Date("2025-06-22"),
        paymentDate: new Date("2025-08-31"),
        perShareAmount: 700,
        totalAmount: 700000,
      },
    ],
  });
  console.log("  ✓ Created shareholder meetings & dividends");

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 23. 実物資産（土地・建物・車・金）─────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  await prisma.personalAsset.deleteMany({});
  await prisma.personalAsset.createMany({
    data: [
      {
        tenantId: tid,
        name: "自宅土地",
        category: "LAND",
        acquiredOn: new Date("2020-04-01"),
        acquisitionCost: 15_000_000,
        currentValue: 16_200_000,
        note: "住宅ローン（住宅金融支援機構）の担保",
      },
      {
        tenantId: tid,
        name: "自宅建物",
        category: "BUILDING",
        acquiredOn: new Date("2020-04-01"),
        acquisitionCost: 18_000_000,
        currentValue: 14_500_000,
        note: "木造・築5年",
      },
      {
        tenantId: tid,
        name: "自家用車（プリウス）",
        category: "VEHICLE",
        acquiredOn: new Date("2023-03-01"),
        acquisitionCost: 3_200_000,
        currentValue: 2_100_000,
      },
      {
        tenantId: tid,
        name: "金地金（インゴット100g）",
        category: "GOLD",
        acquiredOn: new Date("2022-09-01"),
        acquisitionCost: 700_000,
        currentValue: 1_050_000,
        note: "現物保管",
      },
    ],
  });
  console.log("  ✓ Created personal assets");

  // ── 予算配分ルール（既定マスタ） ──────────────────────────────────────
  const allocationCreated = await seedDefaultAllocationRulesForTenant(prisma, tid);
  console.log(`  ✓ Seeded allocation rules (${allocationCreated} created)`);

  console.log("🎉 Seed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
