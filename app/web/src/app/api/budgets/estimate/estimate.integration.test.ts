/**
 * 実績から推測した予算案（GET /api/budgets/estimate）の結合テスト（実 DB 使用）
 *
 *   - 予算の月の前の 3 か月の実績を科目ごとに並べ、平均を返す（実績の無い月は 0 円）
 *   - 科目の無い明細・予算の対象でない科目（資産など）・3 か月より前の実績は数えない
 *   - scope=business は事業の分（按分した額）
 *   - 予算が入っている科目は、平均が 0 でも行に残す
 *   - 前月の予算が未確定（初回）なら、この案でそのまま確定できる
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { createTestEntry } from "@/lib/ledger/test-entries";
import { GET as estimateGet } from "./route";
import { POST as confirmPost } from "../confirm/route";

const SUFFIX = `best_${Date.now()}`;
const YEAR = 2091;

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
type Handler = typeof estimateGet;
const call = (handler: Handler, url: string, method = "GET", body?: unknown) =>
  handler(makeReq(`http://x${url}`, method, body), emptyRouteContext());

type Category = "REVENUE" | "EXPENSE" | "ASSET";
type Acct = { id: number; code: string; category: Category };
let tenantId: number;
let salary: Acct;
let phone: Acct;
let rent: Acct;
let gift: Acct;
let cash: Acct;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records", "budgets"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "推測",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  const mk = async (key: string, name: string, category: Category): Promise<Acct> => {
    const code = `${key}_${SUFFIX}`;
    const a = await prisma.account.create({ data: { tenantId, code, name, category } });
    return { id: a.id, code, category };
  };
  salary = await mk("A1", "給与", "REVENUE");
  phone = await mk("B1", "通信費", "EXPENSE");
  rent = await mk("B2", "家賃", "EXPENSE");
  gift = await mk("B3", "贈答費", "EXPENSE");
  cash = await mk("C1", "現金", "ASSET");

  const entry = (month: number, flow: number, category: Acct | null, businessRatio?: number) =>
    createTestEntry(
      tenantId,
      { kind: "CASH" },
      {
        date: new Date(YEAR, month - 1, 10),
        description: "テスト",
        flow,
        category: category as never,
        ...(businessRatio !== undefined
          ? { business: { businessUse: true, businessRatio } }
          : {}),
      },
    );
  // 予算の月は 11 月。前の 3 か月は 8〜10 月
  await entry(8, 300_000, salary);
  await entry(9, 300_000, salary);
  await entry(10, 300_000, salary);
  await entry(8, -100_000, rent);
  await entry(10, -100_000, rent); // 9 月は家賃の実績なし → 0 円として平均する
  await entry(9, -4_000, phone, 50); // 事業 50%
  await entry(10, -5_000, phone, 50);
  await entry(10, -9_999, null); // 科目なし（数えない）
  await entry(10, -7_000, cash); // 予算の対象でない科目（数えない）
  await entry(7, -50_000, rent); // 3 か月より前（数えない）

  // 11 月に予算が入っている科目（実績は無い）
  const nov = await prisma.period.create({
    data: { tenantId, fiscalYear: YEAR, month: 11, quarter: 4 },
  });
  await prisma.budget.create({
    data: { tenantId, accountId: gift.id, periodId: nov.id, amount: 2_000 },
  });
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("GET /api/budgets/estimate", () => {
  it("前の 3 か月の実績を科目ごとに並べ、平均を返す", async () => {
    const res = await call(estimateGet, `/api/budgets/estimate?year=${YEAR}&month=11`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.months).toEqual([
      { year: YEAR, month: 8 },
      { year: YEAR, month: 9 },
      { year: YEAR, month: 10 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<number, any>(data.rows.map((r: any) => [r.accountId, r]));
    expect(byId.get(salary.id)).toMatchObject({
      months: [300_000, 300_000, 300_000],
      average: 300_000,
      budget: null,
    });
    expect(byId.get(rent.id)).toMatchObject({ months: [100_000, 0, 100_000], average: 66_667 });
    expect(byId.get(phone.id)).toMatchObject({ months: [0, 4_000, 5_000], average: 3_000 });
    // 予算だけある科目は平均 0 で残す
    expect(byId.get(gift.id)).toMatchObject({ months: [0, 0, 0], average: 0, budget: 2_000 });
    expect(byId.has(cash.id)).toBe(false);
    expect(data.rows).toHaveLength(4);
  });

  it("scope=business は事業の分（按分した額）で平均する", async () => {
    const res = await call(
      estimateGet,
      `/api/budgets/estimate?year=${YEAR}&month=11&scope=business`,
    );
    const { data } = await res.json();
    // 事業の予算は入っていないので、事業利用の印のある通信費だけ（2,000・2,500 の平均）
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      accountId: phone.id,
      months: [0, 2_000, 2_500],
      average: 1_500,
      budget: null,
    });
  });

  it("前月の予算が未確定（初回）なら、推測した案でそのまま確定できる", async () => {
    const res = await call(confirmPost, "/api/budgets/confirm", "POST", {
      year: YEAR,
      month: 11,
      items: [
        { accountId: salary.id, amount: 300_000 },
        { accountId: rent.id, amount: 66_667 },
        { accountId: phone.id, amount: 3_000 },
        { accountId: gift.id, amount: 0 },
      ],
    });
    expect(res.status).toBe(201);
    const nov = await prisma.budget.findMany({
      where: { tenantId, scope: "HOUSEHOLD", period: { fiscalYear: YEAR, month: 11 } },
    });
    const amounts = new Map(nov.map((b) => [b.accountId, b.amount.toNumber()]));
    expect(amounts.get(rent.id)).toBe(66_667);
    expect(amounts.get(gift.id)).toBe(0); // 入っていた予算は案の金額に置き換わる
  });
});
