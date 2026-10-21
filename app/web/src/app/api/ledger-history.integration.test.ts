/**
 * 実績管理の「履歴」の明細（GET /api/ledger/history）の結合テスト（実 DB 使用）
 *
 *   - 新しい順に limit 件ずつ返し、total は絞り込み後の全件数
 *   - 種別（現金・銀行・カード）と口座・カードで分かれる
 *   - 状態（未割り当て・実績）・科目・事業利用のみで絞り込める。未割り当ては振替の組を含めない
 *   - 期間・摘要（全角・半角を問わない）・金額（入金・出金を問わず絶対値）で絞り込める。範囲が逆なら 400
 *   - ほかのテナントの明細は返さない
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
import { GET as historyGet } from "./ledger/history/route";

const SUFFIX = `hist_${Date.now()}`;
const YEAR = 2037;

const get = async (qs: string) =>
  (
    await historyGet(
      { method: "GET", nextUrl: new URL(`http://x/api/ledger/history?${qs}`) } as never,
      emptyRouteContext(),
    )
  ).json();

let tenantId: number;
let otherTenantId: number;
let food: { id: number; category: "EXPENSE" };
let tel: { id: number; category: "EXPENSE" };
let bankA: number;
let bankB: number;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "financial_records",
    "bank_accounts",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "履歴",
      passwordHash: "x",
      role: "viewer",
    },
  });
  actingUser = { id: user.id, tenantId, role: "viewer", email: user.email, name: user.name };
  const account = async (tid: number, code: string, name: string) =>
    (await prisma.account.create({ data: { tenantId: tid, code, name, category: "EXPENSE" } })).id;
  food = { id: await account(tenantId, `F_${SUFFIX}`, "食費"), category: "EXPENSE" };
  tel = { id: await account(tenantId, `T_${SUFFIX}`, "通信費"), category: "EXPENSE" };
  bankA = (await prisma.bankAccount.create({ data: { tenantId, name: "A", bankName: "銀行" } })).id;
  bankB = (await prisma.bankAccount.create({ data: { tenantId, name: "B", bankName: "銀行" } })).id;

  // 現金 35 件: 1〜35 日目（20 件は食費、10 件は通信費で事業利用 50%、5 件は未割り当て）
  for (let i = 1; i <= 35; i++) {
    const category = i <= 20 ? food : i <= 30 ? tel : null;
    await createTestEntry(
      tenantId,
      { kind: "CASH" },
      {
        date: new Date(YEAR, 0, i),
        description: `現金${i}`,
        flow: -100 * i,
        ...(category ? { category } : {}),
        ...(i > 20 && i <= 30 ? { business: { businessUse: true, businessRatio: 50 } } : {}),
      },
    );
  }
  // 銀行: A に 2 件（うち 1 件は振替の組）、B に 1 件。どれも未割り当て
  for (const [bank, desc] of [
    [bankA, "A の出金"],
    [bankA, "A の振替"],
    [bankB, "B の入金"],
  ] as const) {
    await createTestEntry(
      tenantId,
      { kind: "BANK", accountId: bank },
      { date: new Date(YEAR, 1, 1), description: desc, flow: -500 },
    );
  }
  await prisma.financialRecord.updateMany({
    where: { tenantId, description: "A の振替" },
    data: { transferGroupId: `tg_${SUFFIX}` },
  });
  // カード: 全角の摘要の出金と、半角の摘要の入金（3 月）
  const card = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "カード", type: "PREPAID_CARD", institution: "テスト" },
    })
  ).id;
  for (const [day, desc, flow] of [
    [10, "[信] ＪＡＬ　Ｐａｙ", -5_000],
    [15, "JAL Pay 返金", 5_000],
    [20, "スーパー", -5_000],
    [25, "[信] ＪＡＬ　Ｐａｙ", -3_000],
  ] as const) {
    await createTestEntry(
      tenantId,
      { kind: "CARD", accountId: card },
      { date: new Date(YEAR, 2, day), description: desc, flow },
    );
  }
  // ほかのテナントの現金
  await createTestEntry(
    otherTenantId,
    { kind: "CASH" },
    { date: new Date(YEAR, 0, 1), description: "ほかのテナント", flow: -1 },
  );
});

afterAll(async () => {
  for (const tid of [tenantId, otherTenantId]) {
    if (!tid) continue;
    const where = { tenantId: tid };
    await prisma.financialRecord.deleteMany({ where });
    await prisma.period.deleteMany({ where });
    await prisma.bankAccount.deleteMany({ where });
    await prisma.linkedAccount.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.tenant.delete({ where: { id: tid } });
  }
  await prisma.$disconnect();
});

const descriptions = (res: { data: { description: string }[] }) =>
  res.data.map((r) => r.description);

describe("GET /api/ledger/history", () => {
  it("新しい順に 30 件ずつ。total は全件数。ほかのテナントの明細は返さない", async () => {
    const first = await get("kind=CASH");
    expect(first.total).toBe(35);
    expect(first.data).toHaveLength(30);
    expect(descriptions(first).slice(0, 2)).toEqual(["現金35", "現金34"]);
    const second = await get("kind=CASH&offset=30");
    expect(descriptions(second)).toEqual(["現金5", "現金4", "現金3", "現金2", "現金1"]);
    expect(JSON.stringify([first, second])).not.toContain("ほかのテナント");
  });

  it("状態・科目・事業利用のみで絞り込める", async () => {
    expect((await get("kind=CASH&status=actual")).total).toBe(30);
    expect((await get("kind=CASH&status=unassigned")).total).toBe(5);
    const byCategory = await get(`kind=CASH&categoryAccountId=${tel.id}`);
    expect(byCategory.total).toBe(10);
    expect(byCategory.data[0]).toMatchObject({
      categoryAccountId: tel.id,
      businessUse: true,
      businessRatio: 50,
    });
    expect((await get("kind=CASH&businessOnly=1")).total).toBe(10);
    expect((await get(`kind=CASH&businessOnly=1&categoryAccountId=${food.id}`)).total).toBe(0);
  });

  it("銀行は口座ごと（省略するとすべての口座）。未割り当てに振替の組は入らない", async () => {
    expect(descriptions(await get(`kind=BANK&accountId=${bankB}`))).toEqual(["B の入金"]);
    expect((await get("kind=BANK")).total).toBe(3);
    expect(descriptions(await get(`kind=BANK&accountId=${bankA}&status=unassigned`))).toEqual([
      "A の出金",
    ]);
    // 銀行の行は口座の API と同じ形（accountId は口座、amount は +入金 / −出金）
    expect((await get(`kind=BANK&accountId=${bankB}`)).data[0]).toMatchObject({
      accountId: bankB,
      amount: -500,
    });
  });

  it("期間・摘要・金額で絞り込める", async () => {
    // 期間は to の日を含む
    expect((await get("kind=CASH&dateFrom=2037-01-05&dateTo=2037-01-10")).total).toBe(6);
    expect((await get("kind=CASH&dateFrom=2037-02-01")).total).toBe(4);
    // 「JAL」で全角の「ＪＡＬ」にも、半角の「JAL」にも当たる
    expect(descriptions(await get("kind=CARD&q=jal"))).toEqual([
      "[信] ＪＡＬ　Ｐａｙ",
      "JAL Pay 返金",
      "[信] ＪＡＬ　Ｐａｙ",
    ]);
    // 金額は入金・出金を問わず絶対値。期間・摘要と組み合わせられる
    expect((await get("kind=CARD&amountMin=5000&amountMax=5000")).total).toBe(3);
    expect(
      descriptions(
        await get("kind=CARD&q=JAL&amountMin=5000&dateFrom=2037-03-11&dateTo=2037-03-31"),
      ),
    ).toEqual(["JAL Pay 返金"]);
    expect((await get("kind=CASH&amountMax=500")).total).toBe(5);
  });

  it("範囲が逆なら 400", async () => {
    for (const qs of [
      "kind=CASH&dateFrom=2037-02-01&dateTo=2037-01-01",
      "kind=CASH&amountMin=10&amountMax=5",
      "kind=CASH&dateFrom=2037/01/01",
      "kind=CASH&dateFrom=2037-01-34",
    ]) {
      const res = await historyGet(
        { method: "GET", nextUrl: new URL(`http://x/api/ledger/history?${qs}`) } as never,
        emptyRouteContext(),
      );
      expect(res.status).toBe(400);
    }
  });

  it("limit は 100 まで", async () => {
    const res = await historyGet(
      {
        method: "GET",
        nextUrl: new URL("http://x/api/ledger/history?kind=CASH&limit=101"),
      } as never,
      emptyRouteContext(),
    );
    expect(res.status).toBe(400);
  });
});
