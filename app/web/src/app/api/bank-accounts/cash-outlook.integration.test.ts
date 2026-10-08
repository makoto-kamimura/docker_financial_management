/**
 * 口座残高サマリ・残高の推移 結合テスト（実 DB 使用）
 *
 * - GET /api/bank-accounts/summary … KPI の対象月の時点の口座ごとの残高（明細の合計 + 差額）
 * - GET /api/bank-accounts/cash-outlook … 今月までは明細の月末残高、先は予算と実績（口座ごとは資金移動ルール）
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/prisma";
import { createTestEntry } from "@/lib/test-entries";
import { emptyRouteContext } from "@/lib/api-handler";
import { GET as summaryGet } from "./summary/route";
import { GET as outlookGet } from "./cash-outlook/route";

const SUFFIX = `co_${Date.now()}`;

function makeReq(url: string) {
  return {
    method: "GET",
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve({}),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}

// 月は今日を起点に数える（いつ実行しても同じ結果になるように）
const now = new Date();
const shift = (delta: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};
const key = (delta: number) => {
  const { year, month } = shift(delta);
  return `${year}-${String(month).padStart(2, "0")}`;
};
const utcDate = (delta: number, day: number) => {
  const { year, month } = shift(delta);
  return new Date(Date.UTC(year, month - 1, day));
};

let tenantId: number;
let bankA: number;
let bankB: number;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "bank_accounts",

    "accounts",
    "periods",
    "budgets",
    "financial_records",
    "transfers",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  actingUser = await prisma.user.create({
    data: {
      tenantId,
      email: `v_${SUFFIX}@example.com`,
      name: "v",
      passwordHash: "x",
      role: "viewer",
    },
  });

  // 口座 A: 差額 100,000、先月 +50,000、今月 1 日 −20,000。口座 B: 2 か月前 +30,000
  const a = await prisma.bankAccount.create({
    data: { tenantId, name: "給与口座", bankName: "テスト銀行", balanceAdjustment: 100_000 },
  });
  const b = await prisma.bankAccount.create({
    data: { tenantId, name: "貯蓄口座", bankName: "テスト銀行" },
  });
  bankA = a.id;
  bankB = b.id;
  const bank = (accountId: number) => ({ kind: "BANK" as const, accountId });
  for (const [id, date, description, flow] of [
    [bankA, utcDate(-1, 15), "入金", 50_000],
    [bankA, utcDate(0, 1), "出金", -20_000],
    [bankB, utcDate(-2, 10), "入金", 30_000],
  ] as const) {
    await createTestEntry(tenantId, bank(id), { date, description, flow });
  }

  // 資金移動ルール: 口座 A は毎月 +200,000 − 150,000 = +50,000
  await prisma.transfer.createMany({
    data: [
      { tenantId, toAccountId: bankA, amount: 200_000, day: 25, label: "給与" },
      { tenantId, fromAccountId: bankA, amount: 150_000, day: 10, label: "支出" },
    ],
  });

  // 予算: 今月の収支 +100,000、来月 +50,000（再来月は予算なし）。今月の実績の収支 +120,000
  const revenue = await prisma.account.create({
    data: { tenantId, code: `4${SUFFIX}`, name: "給与", category: "REVENUE" },
  });
  const expense = await prisma.account.create({
    data: { tenantId, code: `5${SUFFIX}`, name: "生活費", category: "EXPENSE" },
  });
  const period = async (delta: number) => {
    const { year, month } = shift(delta);
    // 明細を入れたときに期間ができていることがあるので upsert
    return prisma.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
      update: {},
      create: { tenantId, fiscalYear: year, month, quarter: Math.ceil(month / 3) },
    });
  };
  const p0 = await period(0);
  const p1 = await period(1);
  await prisma.budget.createMany({
    data: [
      { tenantId, accountId: revenue.id, periodId: p0.id, amount: 300_000 },
      { tenantId, accountId: expense.id, periodId: p0.id, amount: 200_000 },
      { tenantId, accountId: revenue.id, periodId: p1.id, amount: 300_000 },
      { tenantId, accountId: expense.id, periodId: p1.id, amount: 250_000 },
    ],
  });
  await prisma.financialRecord.create({
    data: { tenantId, accountId: revenue.id, periodId: p0.id, amount: 120_000 },
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.financialRecord.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.transfer.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("GET /api/bank-accounts/summary", () => {
  it("先月を選ぶと、先月末までの明細の合計 + 差額を返す", async () => {
    const { year, month } = shift(-1);
    const res = await summaryGet(
      makeReq(`http://x/api/bank-accounts/summary?year=${year}&month=${month}`),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.isCurrentMonth).toBe(false);
    expect(data.asOf.slice(0, 7)).toBe(key(-1));
    expect(data.accounts.map((r: { balance: number }) => r.balance)).toEqual([150_000, 30_000]);
    expect(data.totalBalance).toBe(180_000);
  });
});

describe("GET /api/bank-accounts/cash-outlook", () => {
  it("過去は明細の月末残高、合計の先は予算と実績、口座ごとの先はルールで見込む", async () => {
    const res = await outlookGet(
      makeReq("http://x/api/bank-accounts/cash-outlook?after=2"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // 明細のある最初の月（2 か月前）から、先の 2 か月まで
    expect(body.months).toEqual([key(-2), key(-1), key(0), key(1), key(2)]);
    expect(body.currentKey).toBe(key(0));
    // 今日の合計 160,000。今月 = 160,000 + (100,000 − 120,000)、来月 + 50,000（予算）、再来月 + 50,000（ルール）
    expect(body.total).toEqual([130_000, 180_000, 140_000, 190_000, 240_000]);
    expect(body.totalBasis).toEqual(["actual", "actual", "budget", "budget", "rule"]);
    const a = body.accounts.find((r: { id: number }) => r.id === bankA);
    expect(a.balance).toBe(130_000);
    expect(a.values).toEqual([100_000, 150_000, 130_000, 180_000, 230_000]);
  });
});
