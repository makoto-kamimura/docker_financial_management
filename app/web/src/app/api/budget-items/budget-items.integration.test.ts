/**
 * 予算のカレンダー登録（budget_items）・カードの利用額の推移 結合テスト（実 DB 使用）
 *
 * - POST /api/budget-items … 同じ科目・月の予算に足し、履歴を残し、内訳の 1 件を作る
 * - DELETE /api/budget-items/[id] … 予算から引く
 * - 予算を確定した月は 409
 * - GET /api/linked-accounts/usage-trend … 利用 − 返金（チャージは除く）、先は固定決済
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
import { emptyRouteContext } from "@/lib/api-handler";
import { GET as itemsGet, POST as itemsPost } from "./route";
import { DELETE as itemDelete } from "./[id]/route";
import { GET as budgetsGet } from "../budgets/route";
import { GET as usageGet } from "../linked-accounts/usage-trend/route";

const SUFFIX = `bi_${Date.now()}`;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let accountCode: string;
let cardA: number;
let cardB: number;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "budgets",
    "budget_items",
    "budget_histories",
    "budget_confirmations",
    "linked_accounts",
    "card_transactions",
    "card_recurring_payments",
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
      email: `e_${SUFFIX}@example.com`,
      name: "e",
      passwordHash: "x",
      role: "editor",
    },
  });
  accountCode = `5${SUFFIX}`;
  await prisma.account.create({
    data: { tenantId, code: accountCode, name: "旅行", category: "EXPENSE" },
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.budgetItem.deleteMany({ where });
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.cardRecurringPayment.deleteMany({ where });
  if (cardA)
    await prisma.cardTransaction.deleteMany({ where: { accountId: { in: [cardA, cardB] } } });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const budgetAmount = async () => {
  const b = await prisma.budget.findFirst({
    where: { tenantId, account: { code: accountCode }, period: { fiscalYear: 2031, month: 5 } },
  });
  return b ? Number(b.amount) : null;
};

describe("POST / DELETE /api/budget-items", () => {
  it("登録で予算に足し、削除で引く。履歴と内訳が残る", async () => {
    const post = (amount: number, description: string) =>
      itemsPost(
        makeReq("POST", "http://x/api/budget-items", {
          date: "2031-05-10",
          accountCode,
          description,
          amount,
        }),
        emptyRouteContext(),
      );
    const r1 = await post(30_000, "旅行の宿");
    expect(r1.status).toBe(201);
    expect(await budgetAmount()).toBe(30_000);
    const r2 = await post(20_000, "旅行の交通費");
    const second = (await r2.json()).data;
    expect(await budgetAmount()).toBe(50_000);

    const list = await (
      await itemsGet(
        makeReq("GET", "http://x/api/budget-items?year=2031&month=5"),
        emptyRouteContext(),
      )
    ).json();
    expect(list.data.map((i: { description: string }) => i.description)).toEqual([
      "旅行の宿",
      "旅行の交通費",
    ]);
    // 一覧（GET /api/budgets）にも内訳が返る
    const budgets = await (
      await budgetsGet(makeReq("GET", "http://x/api/budgets?year=2031"), emptyRouteContext())
    ).json();
    expect(budgets.items).toHaveLength(2);
    expect(budgets.items[0]).toMatchObject({ accountCode, month: 5, date: "2031-05-10" });

    const del = await itemDelete(makeReq("DELETE", "http://x"), params(second.id));
    expect(del.status).toBe(204);
    expect(await budgetAmount()).toBe(30_000);
    const histories = await prisma.budgetHistory.findMany({ where: { tenantId } });
    expect(histories.map((h) => [h.action, Number(h.amount)])).toEqual([
      ["create", 30_000],
      ["update", 50_000],
      ["update", 30_000],
    ]);
  });

  it("予算を確定した月は 409", async () => {
    const period = await prisma.period.findFirstOrThrow({
      where: { tenantId, fiscalYear: 2031, month: 5 },
    });
    await prisma.budgetConfirmation.create({ data: { tenantId, periodId: period.id } });
    const res = await itemsPost(
      makeReq("POST", "http://x/api/budget-items", {
        date: "2031-05-20",
        accountCode,
        description: "追加",
        amount: 1_000,
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(409);
    expect(await budgetAmount()).toBe(30_000);
  });
});

describe("GET /api/linked-accounts/usage-trend", () => {
  it("利用 − 返金（チャージとチャージ先に入った側は除く）、先の月は固定決済", async () => {
    const a = await prisma.linkedAccount.create({
      data: { tenantId, name: "テストカード", type: "CREDIT_CARD", institution: "テスト" },
    });
    const b = await prisma.linkedAccount.create({
      data: { tenantId, name: "テスト電子マネー", type: "E_MONEY", institution: "テスト" },
    });
    cardA = a.id;
    cardB = b.id;
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    await prisma.cardTransaction.createMany({
      data: [
        { accountId: cardA, date: thisMonth, description: "買い物", amount: 5_000 },
        { accountId: cardA, date: thisMonth, description: "返金", amount: -1_000 },
        {
          accountId: cardA,
          date: thisMonth,
          description: "チャージ",
          amount: 3_000,
          transferToAccountId: cardB,
        },
        {
          accountId: cardB,
          date: thisMonth,
          description: "入金",
          amount: -3_000,
          chargeGroupId: `g_${SUFFIX}`,
        },
      ],
    });
    await prisma.cardRecurringPayment.create({
      data: { tenantId, accountId: cardA, label: "動画配信", amount: 1_500, day: 10 },
    });

    const res = await usageGet(
      makeReq("GET", "http://x/api/linked-accounts/usage-trend?after=1"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const i = body.months.indexOf(body.currentKey);
    const card = (id: number) => body.cards.find((c: { id: number }) => c.id === id).values;
    expect(card(cardA)[i]).toBe(4_000);
    expect(card(cardB)[i]).toBe(0);
    expect(card(cardA)[i + 1]).toBe(1_500);
    expect(body.total[i]).toBe(4_000);
  });
});
