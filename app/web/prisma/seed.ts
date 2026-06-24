import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

// ── 月次収支サンプルデータ ────────────────────────────────────────────
// 想定ペルソナ：30代 会社員夫婦（共働き）
// 夫: 月収 38→42万、妻: 月収 22→25万、年2回ボーナス

type MonthlyRow = { fiscalYear: number; month: number; amount: number };

function incomeRows(): MonthlyRow[] {
  const rows: MonthlyRow[] = [];
  // H1000 給与（夫）: 2023-2026/06
  const salary: Record<number, number> = { 2023: 380_000, 2024: 400_000, 2025: 420_000, 2026: 430_000 };
  const bonus: Record<number, number>  = { 2023: 600_000, 2024: 650_000, 2025: 700_000, 2026: 720_000 };
  for (const [yearStr, base] of Object.entries(salary)) {
    const year = Number(yearStr);
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const b = (m === 6 || m === 12) ? bonus[year] : 0;
      rows.push({ fiscalYear: year, month: m, amount: base + b });
    }
  }
  return rows;
}

function spouseRows(): MonthlyRow[] {
  const rows: MonthlyRow[] = [];
  // H1100 副業（妻のパート収入）
  const base: Record<number, number> = { 2023: 220_000, 2024: 230_000, 2025: 240_000, 2026: 250_000 };
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
  68_000, 62_000, 65_000, 70_000, 72_000, 75_000,
  78_000, 80_000, 72_000, 68_000, 70_000, 85_000,
];
const DAILY_MONTHLY = [
  18_000, 15_000, 20_000, 16_000, 14_000, 22_000,
  19_000, 17_000, 15_000, 18_000, 20_000, 25_000,
];
const TRANSPORT_MONTHLY = [
  22_000, 20_000, 21_000, 25_000, 28_000, 30_000,
  32_000, 35_000, 28_000, 24_000, 22_000, 20_000,
];
const LEISURE_MONTHLY = [
  25_000, 20_000, 22_000, 35_000, 40_000, 50_000,
  55_000, 60_000, 35_000, 28_000, 30_000, 45_000,
];

// 固定費（EXPENSE）月次データ
const UTILITIES_MONTHLY = [
  18_000, 20_000, 15_000, 10_000, 8_000, 9_000,
  12_000, 14_000, 10_000, 8_000, 12_000, 17_000,
];

function buildMonthlyRows(
  monthly: number[],
  scale = 1.0,
): Omit<MonthlyRow, "fiscalYear">[] {
  return monthly.map((amt, i) => ({ month: i + 1, amount: Math.round(amt * scale) }));
}

// 資産残高（月末時点）
// 口座コード → [2023-01 から 2026-06 の 42か月分の残高]
function linearSeries(start: number, end: number, months = 42): number[] {
  return Array.from({ length: months }, (_, i) =>
    Math.round(start + ((end - start) * i) / (months - 1)),
  );
}

// 株式：緩やかな上昇 + 月ごとの揺れ
function stockSeries(start: number, end: number, months = 42): number[] {
  const trend = linearSeries(start, end, months);
  const waves = [0,3,6,2,-1,-4,5,8,3,-2,4,7, 2,-3,5,9,4,-2,6,10,3,-1,4,8, 2,-3,5,7,3,-2,4,8,2,-1,3,6, 1,-2,4,6,2,0];
  return trend.map((v, i) => Math.round(v + (waves[i % waves.length] ?? 0) * 10_000));
}

async function main() {
  console.log("🌱 Seeding start...");

  // ── 1. 既存の取引データをクリア ──────────────────────────────────────
  await prisma.financialRecord.deleteMany({});
  await prisma.budget.deleteMany({});
  console.log("  ✓ Cleared financial records & budgets");

  // ── 2. 勘定科目 upsert ───────────────────────────────────────────────
  const accs = await Promise.all([
    prisma.account.upsert({ where: { code: "H1000" }, update: { name: "給与・賞与（夫）" }, create: { code: "H1000", name: "給与・賞与（夫）", category: "REVENUE" } }),
    prisma.account.upsert({ where: { code: "H1100" }, update: { name: "給与（妻）" }, create: { code: "H1100", name: "給与（妻）", category: "REVENUE" } }),
    prisma.account.upsert({ where: { code: "H2000" }, update: { name: "食費" },         create: { code: "H2000", name: "食費",         category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2100" }, update: { name: "日用品" },       create: { code: "H2100", name: "日用品",       category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2200" }, update: { name: "交通・移動費" }, create: { code: "H2200", name: "交通・移動費", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H2300" }, update: { name: "娯楽・交際費" }, create: { code: "H2300", name: "娯楽・交際費", category: "COGS" } }),
    prisma.account.upsert({ where: { code: "H3000" }, update: { name: "家賃" },         create: { code: "H3000", name: "家賃",         category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3100" }, update: { name: "水道光熱費" },   create: { code: "H3100", name: "水道光熱費",   category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3200" }, update: { name: "通信費" },       create: { code: "H3200", name: "通信費",       category: "EXPENSE" } }),
    prisma.account.upsert({ where: { code: "H3300" }, update: { name: "保険料" },       create: { code: "H3300", name: "保険料",       category: "EXPENSE" } }),
  ]);
  const [h1000, h1100, h2000, h2100, h2200, h2300, h3000, h3100, h3200, h3300] = accs;

  // 資産口座 upsert（親科目）
  const haParents = await Promise.all([
    prisma.account.upsert({ where: { code: "HA100" }, update: {}, create: { code: "HA100", name: "流動資産",       category: "ASSET" } }),
    prisma.account.upsert({ where: { code: "HA200" }, update: {}, create: { code: "HA200", name: "投資・有価証券", category: "ASSET" } }),
    prisma.account.upsert({ where: { code: "HA300" }, update: {}, create: { code: "HA300", name: "保険資産",       category: "ASSET" } }),
    prisma.account.upsert({ where: { code: "HA400" }, update: {}, create: { code: "HA400", name: "年金・退職金資産", category: "ASSET" } }),
  ]);
  const [ha100, ha200, ha300, ha400] = haParents;

  // 資産口座 upsert（子科目）
  const haChildren = await Promise.all([
    prisma.account.upsert({ where: { code: "HA101" }, update: {}, create: { code: "HA101", name: "旅行積立",        category: "ASSET", parentId: ha100.id } }),
    prisma.account.upsert({ where: { code: "HA102" }, update: {}, create: { code: "HA102", name: "現金",            category: "ASSET", parentId: ha100.id } }),
    prisma.account.upsert({ where: { code: "HA103" }, update: {}, create: { code: "HA103", name: "普通預金",        category: "ASSET", parentId: ha100.id } }),
    prisma.account.upsert({ where: { code: "HA104" }, update: {}, create: { code: "HA104", name: "定期預金（SBI）", category: "ASSET", parentId: ha100.id } }),
    prisma.account.upsert({ where: { code: "HA201" }, update: {}, create: { code: "HA201", name: "株式（国内）",    category: "ASSET", parentId: ha200.id } }),
    prisma.account.upsert({ where: { code: "HA202" }, update: {}, create: { code: "HA202", name: "株式（外国）",    category: "ASSET", parentId: ha200.id } }),
    prisma.account.upsert({ where: { code: "HA203" }, update: {}, create: { code: "HA203", name: "国内債券",        category: "ASSET", parentId: ha200.id } }),
    prisma.account.upsert({ where: { code: "HA204" }, update: {}, create: { code: "HA204", name: "外国債券",        category: "ASSET", parentId: ha200.id } }),
    prisma.account.upsert({ where: { code: "HA301" }, update: {}, create: { code: "HA301", name: "保険（終身）",    category: "ASSET", parentId: ha300.id } }),
    prisma.account.upsert({ where: { code: "HA302" }, update: {}, create: { code: "HA302", name: "保険（学資）",    category: "ASSET", parentId: ha300.id } }),
    prisma.account.upsert({ where: { code: "HA401" }, update: {}, create: { code: "HA401", name: "厚生年金",        category: "ASSET", parentId: ha400.id } }),
    prisma.account.upsert({ where: { code: "HA402" }, update: {}, create: { code: "HA402", name: "退職金（見込）",  category: "ASSET", parentId: ha400.id } }),
  ]);
  const [ha101, ha102, ha103, ha104, ha201, ha202, ha203, ha204, ha301, ha302, ha401, ha402] = haChildren;

  console.log("  ✓ Upserted accounts");

  // 部門
  const dept = await prisma.department.upsert({ where: { id: 1 }, update: {}, create: { name: "家庭" } });

  // ── 3. 会計期間生成（2023-01 〜 2026-06）────────────────────────────
  const periodMap = new Map<string, { id: number }>();
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const p = await prisma.period.upsert({
        where: { fiscalYear_month: { fiscalYear: year, month } },
        update: {},
        create: { fiscalYear: year, month, quarter: Math.ceil(month / 3) },
      });
      periodMap.set(`${year}-${month}`, p);
    }
  }
  console.log("  ✓ Created periods (2023-01 ~ 2026-06)");

  // ── 4. 収支 financial records ────────────────────────────────────────
  async function insertRows(accountId: number, rows: MonthlyRow[]) {
    for (const row of rows) {
      const p = periodMap.get(`${row.fiscalYear}-${row.month}`);
      if (!p) continue;
      await prisma.financialRecord.create({
        data: { accountId, departmentId: dept.id, periodId: p.id, amount: row.amount },
      });
    }
  }

  // 収入
  await insertRows(h1000.id, incomeRows());
  await insertRows(h1100.id, spouseRows());

  // 変動費（COGS）: 年次スケールを微調整
  for (const [year, scale] of [[2023, 1.0], [2024, 1.05], [2025, 1.08], [2026, 1.10]] as [number, number][]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      await prisma.financialRecord.createMany({
        data: [
          { accountId: h2000.id, departmentId: dept.id, periodId: p.id, amount: Math.round(FOOD_MONTHLY[i] * scale) },
          { accountId: h2100.id, departmentId: dept.id, periodId: p.id, amount: Math.round(DAILY_MONTHLY[i] * scale) },
          { accountId: h2200.id, departmentId: dept.id, periodId: p.id, amount: Math.round(TRANSPORT_MONTHLY[i] * scale) },
          { accountId: h2300.id, departmentId: dept.id, periodId: p.id, amount: Math.round(LEISURE_MONTHLY[i] * scale) },
        ],
      });
    }
  }

  // 固定費（EXPENSE）
  for (const [year, rentScale] of [[2023, 1.0], [2024, 1.0], [2025, 1.0], [2026, 1.0]] as [number, number][]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      const i = m - 1;
      const commScale = year >= 2025 ? 0.9 : 1.0; // 2025年にプラン変更で通信費↓
      await prisma.financialRecord.createMany({
        data: [
          { accountId: h3000.id, departmentId: dept.id, periodId: p.id, amount: Math.round(120_000 * rentScale) },
          { accountId: h3100.id, departmentId: dept.id, periodId: p.id, amount: UTILITIES_MONTHLY[i] },
          { accountId: h3200.id, departmentId: dept.id, periodId: p.id, amount: Math.round(12_000 * commScale) },
          { accountId: h3300.id, departmentId: dept.id, periodId: p.id, amount: 30_000 },
        ],
      });
    }
  }

  console.log("  ✓ Created income & expense records");

  // ── 5. 資産残高（月末）────────────────────────────────────────────────
  const assetData: [number, number[]][] = [
    [ha101.id, linearSeries(    100_000,   1_250_000)],  // 旅行積立: コツコツ積み上げ
    [ha102.id, [                                          // 現金: 月によって揺れる
      65_000,55_000,70_000,48_000,60_000,52_000,
      58_000,73_000,61_000,50_000,67_000,45_000,
      62_000,54_000,71_000,49_000,63_000,55_000,
      60_000,75_000,58_000,52_000,68_000,47_000,
      64_000,56_000,72_000,50_000,65_000,57_000,
      61_000,77_000,59_000,53_000,69_000,48_000,
      66_000,58_000,74_000,51_000,66_000,59_000,
    ]],
    [ha103.id, linearSeries(  1_800_000,   5_500_000)],  // 普通預金: 毎月貯蓄
    [ha104.id, [                                          // 定期預金: 年ごとに追加
      ...Array(12).fill(1_000_000),
      ...Array(12).fill(1_500_000),
      ...Array(12).fill(2_000_000),
      ...Array(6).fill(2_000_000),
    ]],
    [ha201.id, stockSeries(    800_000,   2_800_000)],    // 株式（国内）: 右肩上がり
    [ha202.id, stockSeries(    300_000,   1_200_000)],    // 株式（外国）
    [ha203.id, linearSeries(   500_000,     700_000)],   // 国内債券: 安定
    [ha204.id, linearSeries(   200_000,     600_000)],   // 外国債券
    [ha301.id, linearSeries( 2_500_000,   3_000_000)],   // 保険（終身）
    [ha302.id, linearSeries(   800_000,   1_200_000)],   // 保険（学資）
    [ha401.id, linearSeries( 3_000_000,   4_100_000)],   // 厚生年金
    [ha402.id, linearSeries( 5_000_000,   6_200_000)],   // 退職金見込み
  ];

  let monthIndex = 0;
  for (let year = 2023; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) { monthIndex++; continue; }
      for (const [accId, series] of assetData) {
        const amount = series[monthIndex];
        if (amount == null) continue;
        await prisma.financialRecord.create({
          data: { accountId: accId, departmentId: dept.id, periodId: p.id, amount },
        });
      }
      monthIndex++;
    }
  }

  console.log("  ✓ Created asset balance records");

  // ── 6. 予算（年間計画）───────────────────────────────────────────────
  const budgetDef: [number, number][] = [
    [h1000.id, 5_760_000],  // 夫給与: 月48万×12 (ボーナス含む年額)
    [h1100.id, 2_880_000],  // 妻給与: 月24万×12
    [h2000.id,   900_000],  // 食費: 月7.5万×12
    [h2100.id,   216_000],  // 日用品: 月1.8万×12
    [h2200.id,   300_000],  // 交通費: 月2.5万×12
    [h2300.id,   360_000],  // 娯楽費: 月3万×12
    [h3000.id, 1_440_000],  // 家賃: 月12万×12
    [h3100.id,   156_000],  // 光熱費: 月1.3万×12
    [h3200.id,   130_000],  // 通信費: 月1.1万×12
    [h3300.id,   360_000],  // 保険料: 月3万×12
  ];

  for (const year of [2023, 2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 6 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const p = periodMap.get(`${year}-${m}`);
      if (!p) continue;
      for (const [accId, annual] of budgetDef) {
        await prisma.budget.upsert({
          where: { accountId_periodId: { accountId: accId, periodId: p.id } },
          update: { amount: Math.round(annual / 12) },
          create: { accountId: accId, periodId: p.id, amount: Math.round(annual / 12) },
        });
      }
    }
  }

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

  const transferList = [
    { fromAccountId: null, toAccountId: salary.id, amount: 450_000, kind: "AUTO" as const, channel: "INCOME" as const, label: "給与", day: 25, note: "毎月の給与振込" },
    { fromAccountId: salary.id, toAccountId: withdrawal.id, amount: 250_000, kind: "AUTO" as const, channel: "BANK_TRANSFER" as const, day: 26, note: "引き落とし用に移動" },
    { fromAccountId: salary.id, toAccountId: savings.id, amount: 100_000, kind: "MANUAL" as const, channel: "BANK_TRANSFER" as const, day: 25, note: "貯蓄積立" },
    { fromAccountId: withdrawal.id, toAccountId: null, amount: 120_000, kind: "AUTO" as const, channel: "CARD_PAYMENT" as const, label: "楽天カード", day: 27, note: "カード利用分の引き落とし" },
    { fromAccountId: withdrawal.id, toAccountId: null, amount: 90_000, kind: "AUTO" as const, channel: "AUTO_DEBIT" as const, label: "家賃", day: 27, note: "家賃の自動引き落とし" },
  ];
  const existingTransfers = await prisma.transfer.count();
  if (existingTransfers === 0) {
    for (const t of transferList) await prisma.transfer.create({ data: t });
  }
  console.log("  ✓ Created budgets & bank transfers");

  // ── 7. ユーザー ──────────────────────────────────────────────────────
  for (const u of [
    { email: "admin@example.com",  name: "管理者", role: "admin"  },
    { email: "editor@example.com", name: "編集者", role: "editor" },
    { email: "viewer@example.com", name: "閲覧者", role: "viewer" },
  ]) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: hashPassword("password") },
    });
  }

  console.log("  ✓ Users ready (password: 'password')");
  console.log("🎉 Seed completed!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
