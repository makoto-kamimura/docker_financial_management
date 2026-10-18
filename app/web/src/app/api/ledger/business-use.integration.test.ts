/**
 * 明細の事業利用・按分と、学習ルールの事業利用の結合テスト（実 DB 使用）
 *
 *   - 科目の割り当てで事業利用・按分を付けられる。按分を省略すると、科目の事業利用按分の割合（無ければ 100%）
 *   - learn なら学習ルールにも事業利用を覚える。科目だけを変えたときは、覚えた事業利用を消さない
 *   - 同じ摘要の未割り当ての明細にも、科目と一緒に事業利用が付く
 *   - 学習ルールの事業利用は、CSV の取り込み・手入力・まとめて自動処理で当たる
 *   - 振替・チャージの組にすると事業利用は外れる。組の明細や明細でない行は事業利用を持てない（CHECK 制約）
 *   - 実績の確定の一覧（includeAssigned）・まとめて事業利用にする API・学習ルールの一覧と保存
 *   - 実績を確定済みの月の明細は、事業利用も変えられない
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { createTestEntry } from "@/lib/ledger/test-entries";
import { PATCH as bankCategorize } from "../bank-transactions/[id]/categorize/route";
import { PATCH as bankCharge } from "../bank-transactions/[id]/charge/route";
import { POST as bankTxnPost } from "../bank-accounts/[id]/transactions/route";
import { POST as importsPost } from "../imports/route";
import { POST as cashPost } from "../actuals/route";
import { POST as apportionmentPost } from "../apportionments/route";
import { GET as unassignedGet } from "./unassigned/route";
import { PATCH as businessPatch } from "./business/route";
import { POST as autoProcessPost } from "./auto-process/route";
import { GET as rulesGet, PUT as rulesPut } from "./category-rules/route";

const SUFFIX = `biz_${Date.now()}`;
const YEAR = 2033;

function makeReq(method: string, url: string, body?: unknown, contentType = "application/json") {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body ?? {})),
    headers: new Headers({ "Content-Type": contentType }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const day = (m: number, d: number) => new Date(YEAR, m - 1, d);

let tenantId: number;
let comm: { id: number; code: string; category: string };
let food: { id: number; code: string; category: string };
let bankId: number;
let cardId: number;

async function categorize(id: number, body: object) {
  const res = await bankCategorize(
    makeReq("PATCH", `http://x/api/bank-transactions/${id}/categorize`, body),
    params(id),
  );
  return { status: res.status, json: await res.json() };
}
const bankEntry = (date: Date, description: string, flow: number) =>
  createTestEntry(tenantId, { kind: "BANK", accountId: bankId }, { date, description, flow });
const record = (id: number) => prisma.financialRecord.findUniqueOrThrow({ where: { id } });
const rule = (keyword: string) =>
  prisma.txnCategoryRule.findFirst({ where: { tenantId, keyword } });

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "事業",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  const mk = (code: string, name: string) =>
    prisma.account.create({
      data: { tenantId, code: `${code}_${SUFFIX}`, name, category: "EXPENSE" },
    });
  [comm, food] = await Promise.all([mk("COMM", "通信費"), mk("FOOD", "食費")]);
  bankId = (
    await prisma.bankAccount.create({
      data: { tenantId, name: "事業口座", bankName: "テスト銀行" },
    })
  ).id;
  cardId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "テスト電子マネー", type: "E_MONEY", institution: "テスト" },
    })
  ).id;
  // 通信費は事業利用按分 40%
  const res = await apportionmentPost(
    makeReq("POST", "http://x/api/apportionments", {
      accountId: comm.id,
      businessRate: 40,
      description: null, // 画面は空欄を null で送る（以前は 400 だった）
    }),
    emptyRouteContext(),
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.apportionment.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("科目の割り当てで事業利用を付ける", () => {
  it("按分を省略すると科目の事業利用按分の割合。無ければ 100%", async () => {
    const a = await bankEntry(day(1, 5), "携帯電話料金", -5000);
    const r1 = await categorize(a.id, { categoryAccountId: comm.id, businessUse: true });
    expect(r1.status).toBe(200);
    expect(r1.json.data).toMatchObject({ businessUse: true, businessRatio: 40 });

    const b = await bankEntry(day(1, 6), "文房具", -1000);
    await categorize(b.id, { categoryAccountId: food.id, businessUse: true });
    expect(await record(b.id)).toMatchObject({ businessUse: true });
    expect(Number((await record(b.id)).businessRatio)).toBe(100);
  });

  it("按分を指定でき、事業利用を外すと按分も消える", async () => {
    const a = await bankEntry(day(1, 7), "プロバイダ", -3000);
    await categorize(a.id, { categoryAccountId: comm.id, businessUse: true, businessRatio: 33.33 });
    expect(Number((await record(a.id)).businessRatio)).toBe(33.33);
    await categorize(a.id, { businessUse: false });
    expect(await record(a.id)).toMatchObject({
      businessUse: false,
      businessRatio: null,
      accountId: comm.id,
    });
  });

  it("按分の範囲外は 400", async () => {
    const a = await bankEntry(day(1, 8), "範囲外", -100);
    expect((await categorize(a.id, { businessUse: true, businessRatio: 0 })).status).toBe(400);
    expect((await categorize(a.id, { businessUse: true, businessRatio: 101 })).status).toBe(400);
  });

  it("learn で学習ルールに事業利用を覚え、同じ摘要の未割り当ての明細にも付く", async () => {
    const a = await bankEntry(day(2, 1), "クラウドサーバー 2月", -2000);
    const sibling = await bankEntry(day(2, 15), "クラウドサーバー 2月", -2000);
    const r = await categorize(a.id, {
      categoryAccountId: comm.id,
      businessUse: true,
      businessRatio: 80,
      learn: true,
    });
    expect(r.json.updatedSiblingCount).toBe(1);
    expect(await record(sibling.id)).toMatchObject({ accountId: comm.id, businessUse: true });
    expect(Number((await record(sibling.id)).businessRatio)).toBe(80);
    const learned = await rule("クラウドサーバー 2月");
    expect(learned).toMatchObject({ categoryAccountId: comm.id, businessUse: true });
    expect(Number(learned!.businessRatio)).toBe(80);

    // 科目だけを変えて覚え直しても、覚えた事業利用は消えない
    await categorize(a.id, { categoryAccountId: food.id, learn: true });
    const relearned = await rule("クラウドサーバー 2月");
    expect(relearned).toMatchObject({ categoryAccountId: food.id, businessUse: true });
  });

  it("実績を確定済みの月の明細は、事業利用も変えられない（409）", async () => {
    const a = await bankEntry(day(3, 1), "確定済み", -100);
    await prisma.actualsConfirmation.create({ data: { tenantId, periodId: a.periodId } });
    try {
      expect((await categorize(a.id, { businessUse: true })).status).toBe(409);
    } finally {
      await prisma.actualsConfirmation.deleteMany({ where: { periodId: a.periodId } });
    }
  });
});

describe("学習ルールの事業利用が当たる", () => {
  beforeAll(async () => {
    await prisma.txnCategoryRule.create({
      data: {
        tenantId,
        keyword: "レンタルオフィス",
        categoryAccountId: comm.id,
        priority: 100,
        businessUse: true,
        businessRatio: 100,
      },
    });
    // 事業利用を決めないルール
    await prisma.txnCategoryRule.create({
      data: { tenantId, keyword: "スーパー", categoryAccountId: food.id, priority: 100 },
    });
  });

  it("CSV の取り込みで、ルールの事業利用が付く。決めないルールは事業利用なし", async () => {
    const csv = [
      "date,description,amount",
      `${YEAR}-04-01,レンタルオフィス 4月,-30000`,
      `${YEAR}-04-02,スーパー 駅前,-2000`,
    ].join("\n");
    const res = await importsPost(
      makeReq("POST", `http://x/api/imports?target=bank&accountId=${bankId}`, csv, "text/csv"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const rows = await prisma.financialRecord.findMany({
      where: { tenantId, date: { gte: day(4, 1), lt: day(4, 3) } },
      orderBy: { date: "asc" },
    });
    expect(
      rows.map((r) => [r.accountId, r.businessUse, r.businessRatio && Number(r.businessRatio)]),
    ).toEqual([
      [comm.id, true, 100],
      [food.id, false, null],
    ]);
  });

  it("手入力でも、ルールが科目を決めたときはルールの事業利用。指定すればそちらが優先", async () => {
    const post = (body: object) =>
      bankTxnPost(
        makeReq("POST", `http://x/api/bank-accounts/${bankId}/transactions`, {
          date: `${YEAR}-04-10`,
          amount: -1000,
          ...body,
        }),
        params(bankId),
      ).then((r) => r.json());
    const byRule = await post({ description: "レンタルオフィス 追加" });
    expect(byRule.data).toMatchObject({
      categoryAccountId: comm.id,
      businessUse: true,
      businessRatio: 100,
    });
    const explicit = await post({ description: "レンタルオフィス 私用", businessUse: false });
    expect(explicit.data).toMatchObject({ businessUse: false, businessRatio: null });
  });

  it("現金の登録で事業利用を指定し、learn で覚える", async () => {
    const res = await cashPost(
      makeReq("POST", "http://x/api/actuals", {
        date: `${YEAR}-04-11`,
        description: "コワーキング",
        accountCode: comm.code,
        amount: 1500,
        direction: "expense",
        businessUse: true,
        learn: true,
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ businessUse: true, businessRatio: 40 });
    expect(await rule("コワーキング")).toMatchObject({ businessUse: true });
  });

  it("まとめて自動処理で、ルールの事業利用が付く", async () => {
    const a = await bankEntry(day(4, 20), "レンタルオフィス 会議室", -5000);
    const res = await autoProcessPost(
      makeReq("POST", "http://x/api/ledger/auto-process"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    expect(await record(a.id)).toMatchObject({ accountId: comm.id, businessUse: true });
  });
});

describe("振替・チャージの組と CHECK 制約", () => {
  it("チャージにすると事業利用は外れる", async () => {
    const a = await bankEntry(day(5, 1), "チャージ", -3000);
    await categorize(a.id, { categoryAccountId: food.id, businessUse: true });
    const res = await bankCharge(
      makeReq("PATCH", `http://x/api/bank-transactions/${a.id}/charge`, {
        chargeToAccountId: cardId,
      }),
      params(a.id),
    );
    expect(res.status).toBe(200);
    expect(await record(a.id)).toMatchObject({
      businessUse: false,
      businessRatio: null,
      accountId: null,
    });
  });

  it("明細でない行・按分の無い事業利用・組の明細は、DB が受け付けない", async () => {
    const period = (await bankEntry(day(5, 2), "期間用", -1)).periodId;
    await expect(
      prisma.financialRecord.create({
        data: {
          tenantId,
          periodId: period,
          accountId: food.id,
          amount: 1,
          businessUse: true,
          businessRatio: 50,
        },
      }),
    ).rejects.toThrow();
    const a = await bankEntry(day(5, 3), "按分なし", -100);
    await expect(
      prisma.financialRecord.update({ where: { id: a.id }, data: { businessUse: true } }),
    ).rejects.toThrow();
    await expect(
      prisma.financialRecord.update({
        where: { id: a.id },
        data: { businessUse: true, businessRatio: 50, transferGroupId: "x" },
      }),
    ).rejects.toThrow();
  });
});

describe("実績の確定の一覧とまとめての設定", () => {
  it("includeAssigned で割り当て済みも返し、未割り当ての件数を返す", async () => {
    const assigned = await bankEntry(day(6, 1), "割り当て済み", -1000);
    await categorize(assigned.id, {
      categoryAccountId: comm.id,
      businessUse: true,
      businessRatio: 50,
    });
    const unassigned = await bankEntry(day(6, 2), "未割り当て", -500);

    const get = async (q: string) =>
      (
        await unassignedGet(
          makeReq("GET", `http://x/api/ledger/unassigned?year=${YEAR}&month=6${q}`),
          emptyRouteContext(),
        )
      ).json();
    const only = await get("");
    expect(only.data.map((r: { id: number }) => r.id)).toEqual([unassigned.id]);
    expect(only.unassignedCount).toBe(1);

    const all = await get("&includeAssigned=1");
    expect(all.unassignedCount).toBe(1);
    expect(all.data.find((r: { id: number }) => r.id === assigned.id)).toMatchObject({
      categoryAccountId: comm.id,
      categoryAccount: { name: "通信費" },
      businessUse: true,
      businessRatio: 50,
      businessAmount: 500,
    });
  });

  it("ある月のある科目の明細をまとめて事業利用にする。確定済みの月は飛ばす", async () => {
    const a = await bankEntry(day(7, 1), "電話 7月", -2000);
    const b = await bankEntry(day(7, 2), "電話 7月 2", -3000);
    for (const e of [a, b]) await categorize(e.id, { categoryAccountId: comm.id });
    const res = await businessPatch(
      makeReq("PATCH", "http://x/api/ledger/business", {
        year: YEAR,
        month: 7,
        categoryAccountId: comm.id,
        businessUse: true,
      }),
      emptyRouteContext(),
    );
    expect((await res.json()).data).toEqual({ updated: 2, locked: 0 });
    expect(Number((await record(b.id)).businessRatio)).toBe(40);

    await prisma.actualsConfirmation.create({ data: { tenantId, periodId: a.periodId } });
    try {
      const again = await businessPatch(
        makeReq("PATCH", "http://x/api/ledger/business", { ids: [a.id], businessUse: false }),
        emptyRouteContext(),
      );
      expect((await again.json()).data).toEqual({ updated: 0, locked: 1 });
    } finally {
      await prisma.actualsConfirmation.deleteMany({ where: { periodId: a.periodId } });
    }
  });
});

describe("学習ルールの一覧と保存", () => {
  it("事業利用を返し、保存できる。省略した行は事業利用を変えない", async () => {
    const list = (
      await (
        await rulesGet(makeReq("GET", "http://x/api/ledger/category-rules"), emptyRouteContext())
      ).json()
    ).data;
    const office = list.find((r: { keyword: string }) => r.keyword === "レンタルオフィス");
    expect(office).toMatchObject({ businessUse: true, businessRatio: 100 });

    const put = (items: object[]) =>
      rulesPut(
        makeReq("PUT", "http://x/api/ledger/category-rules", { items }),
        emptyRouteContext(),
      );
    // 事業利用を 60% に変え、新しいルールは事業利用なしで足す
    let res = await put([
      {
        id: office.id,
        keyword: office.keyword,
        categoryAccountId: comm.id,
        businessUse: true,
        businessRatio: 60,
      },
      { keyword: "ドラッグストア", categoryAccountId: food.id, businessUse: false },
    ]);
    expect(res.status).toBe(200);
    expect(Number((await rule("レンタルオフィス"))!.businessRatio)).toBe(60);
    expect(await rule("ドラッグストア")).toMatchObject({ businessUse: false, businessRatio: null });

    // 事業利用を送らない（古いアプリ）と、そのまま残る
    res = await put([{ id: office.id, keyword: office.keyword, categoryAccountId: food.id }]);
    expect(res.status).toBe(200);
    expect(await rule("レンタルオフィス")).toMatchObject({
      categoryAccountId: food.id,
      businessUse: true,
    });
  });
});
