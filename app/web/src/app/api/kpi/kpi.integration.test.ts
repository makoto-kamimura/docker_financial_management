/**
 * KPI の年間見込み 結合テスト（実 DB 使用）
 *
 * テナントの決算月（tenants.closingMonth）で期を区切り、未入力の月を按分した年間見込みを
 * GET /api/kpi が返すことを、実際のルートハンドラ経由で確かめる。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
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
import { emptyRouteContext } from "@/lib/api-handler";
import { GET as kpiGet } from "./route";

const SUFFIX = `kpi_${Date.now()}`;
const YEAR = 2096; // 他のテストと衝突しない専用の年度

const makeReq = (url: string) =>
  ({
    method: "GET",
    nextUrl: new URL(url, "http://localhost:3000"),
    headers: new Headers(),
  }) as unknown as import("next/server").NextRequest;

let tenantId: number;

async function kpi(period: string) {
  const res = await kpiGet(makeReq(`http://x/api/kpi?period=${period}`), emptyRouteContext());
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `viewer_${SUFFIX}@example.com`,
      name: "v",
      passwordHash: "x",
      role: "viewer",
    },
  });
  actingUser = user;

  const salary = await prisma.account.create({
    data: { tenantId, code: `R_${SUFFIX}`, name: "給与", category: "REVENUE" },
  });
  const food = await prisma.account.create({
    data: { tenantId, code: `F_${SUFFIX}`, name: "食費", category: "EXPENSE" },
  });
  // 入力は 3 月（前の期）と 4 月だけ
  for (const [month, revenue, expense] of [
    [3, 999_999, 0],
    [4, 300_000, 200_000],
  ]) {
    const period = await prisma.period.create({
      data: { tenantId, fiscalYear: YEAR, month, quarter: Math.ceil(month / 3) },
    });
    await prisma.financialRecord.createMany({
      data: [
        { tenantId, accountId: salary.id, periodId: period.id, amount: revenue },
        { tenantId, accountId: food.id, periodId: period.id, amount: expense },
      ],
    });
  }
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("GET /api/kpi の年間見込み", () => {
  it("12 月決算（既定）: 未入力の 1・2 月は入力済み月の平均で埋める", async () => {
    const data = await kpi(`${YEAR}-04`);
    expect(data.kpi.ytd).toBe(1_299_999);
    expect(data.kpi).not.toHaveProperty("mom");
    expect(data.annual).toMatchObject({
      closingMonth: 12,
      startKey: `${YEAR}-01`,
      elapsedMonths: 4,
      enteredMonths: 2,
      missingMonths: 2,
    });
    expect(data.annualProfit.ytd).toBe(1_099_999); // 999,999 + (300,000 − 200,000)
  });

  it("3 月決算: 4 月始まりの期で集計し、前の期の 3 月は累計に含めない", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { closingMonth: 3 } });
    const data = await kpi(`${YEAR}-04`);
    expect(data.kpi.ytd).toBe(300_000); // 3 月は前の期
    expect(data.annual).toMatchObject({
      closingMonth: 3,
      startKey: `${YEAR}-04`,
      endKey: `${YEAR + 1}-03`,
      elapsedMonths: 1,
      missingMonths: 0,
      remainingMonths: 11,
    });
    // 残り月の予測（移動平均）は前の期の 3 月も学習に使うため、4 月 × 12 ちょうどにはならない
    expect(data.annual.projected).toBeGreaterThan(300_000 * 12);
    expect(data.annualProfit.ytd).toBe(100_000);
  });
});
