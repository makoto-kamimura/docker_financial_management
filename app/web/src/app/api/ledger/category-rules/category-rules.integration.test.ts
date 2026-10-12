/**
 * 学習ルール（txn_category_rules）の一覧と変更 結合テスト（実 DB 使用）
 *
 *   - GET で自テナントのルールだけが、キーワードの順に返る
 *   - PUT で追加・変更・削除ができ、キーワードは覚えるときと同じく正規化して保存する
 *   - 空・重複のキーワードは 400、他テナントの科目は 404、収入・支出以外の科目は 400、viewer は 403
 *   - キーワードを入れ替えても一意制約に当たらない
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// requireRole はモックし、テスト側で「現在のユーザー」を差し替える（権限の順位は本物と同じ）
const RANK: Record<string, number> = { viewer: 1, accountant: 2, editor: 3, admin: 4 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    if ((RANK[actingUser.role] ?? 0) < RANK[min]) {
      return { error: new Response("forbidden", { status: 403 }) };
    }
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { GET as rulesGet, PUT as rulesPut } from "./route";

const SUFFIX = `cr_${Date.now()}`;

function makeReq(method: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL("http://localhost:3000/api/ledger/category-rules"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

type RuleRow = { id: number; keyword: string; priority: number; categoryAccount: { id: number } };

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
const ids: Record<string, number> = {};

async function list(): Promise<RuleRow[]> {
  const res = await rulesGet(makeReq("GET"), emptyRouteContext());
  expect(res.status).toBe(200);
  return (await res.json()).data;
}
const put = (body: unknown) => rulesPut(makeReq("PUT", body), emptyRouteContext());

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "txn_category_rules", "audit_logs"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  editor = await prisma.user.create({
    data: {
      tenantId,
      email: `e_${SUFFIX}@example.com`,
      name: "e",
      passwordHash: "x",
      role: "editor",
    },
  });
  viewer = await prisma.user.create({
    data: {
      tenantId,
      email: `v_${SUFFIX}@example.com`,
      name: "v",
      passwordHash: "x",
      role: "viewer",
    },
  });

  for (const [key, name, category, tid] of [
    ["food", "食費", "COGS", "own"],
    ["daily", "日用品費", "COGS", "own"],
    ["salary", "給与", "REVENUE", "own"],
    ["asset", "普通預金", "ASSET", "own"],
    ["foreign", "他社の食費", "COGS", "other"],
  ] as const) {
    const a = await prisma.account.create({
      data: {
        tenantId: tid === "own" ? tenantId : otherTenantId,
        code: `${key}_${SUFFIX}`,
        name,
        category,
      },
    });
    ids[key] = a.id;
  }

  // 明細に科目を付けて覚えたルール（優先度 100）と、他テナントのルール
  await prisma.txnCategoryRule.createMany({
    data: [
      { tenantId, keyword: "SUPER", categoryAccountId: ids.food, priority: 100 },
      { tenantId, keyword: "DRUG", categoryAccountId: ids.daily, priority: 100 },
      { tenantId: otherTenantId, keyword: "SUPER", categoryAccountId: ids.foreign, priority: 100 },
    ],
  });
});

afterAll(async () => {
  for (const tid of [tenantId, otherTenantId]) {
    await prisma.txnCategoryRule.deleteMany({ where: { tenantId: tid } });
    await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
    await prisma.user.deleteMany({ where: { tenantId: tid } });
    await prisma.account.deleteMany({ where: { tenantId: tid } });
    await prisma.tenant.delete({ where: { id: tid } });
  }
  await prisma.$disconnect();
});

describe("学習ルールの一覧と変更", () => {
  it("GET は自テナントのルールだけを、キーワードの順に返す", async () => {
    actingUser = viewer;
    const rows = await list();
    expect(rows.map((r) => r.keyword)).toEqual(["DRUG", "SUPER"]);
    expect(rows.find((r) => r.keyword === "SUPER")!.categoryAccount.id).toBe(ids.food);
  });

  it("viewer は変更できない（403）", async () => {
    actingUser = viewer;
    expect((await put({ items: [] })).status).toBe(403);
  });

  it("追加・変更・削除をまとめて保存し、キーワードは正規化する", async () => {
    actingUser = editor;
    const before = await list();
    const superRule = before.find((r) => r.keyword === "SUPER")!;
    const drugRule = before.find((r) => r.keyword === "DRUG")!;
    const res = await put({
      items: [
        { id: superRule.id, keyword: "super  market ", categoryAccountId: ids.food },
        { keyword: "  給与振込 ", categoryAccountId: ids.salary },
      ],
      removedIds: [drugRule.id],
    });
    expect(res.status).toBe(200);
    const rows: RuleRow[] = (await res.json()).data;
    expect(rows.map((r) => [r.keyword, r.categoryAccount.id, r.priority])).toEqual([
      ["SUPER MARKET", ids.food, 100],
      ["給与振込", ids.salary, 100],
    ]);
    // 他テナントのルールは変わらない
    const other = await prisma.txnCategoryRule.findMany({ where: { tenantId: otherTenantId } });
    expect(other.map((r) => r.keyword)).toEqual(["SUPER"]);
  });

  it("キーワードを入れ替えても保存できる（一意制約に当たらない）", async () => {
    actingUser = editor;
    const [a, b] = await list();
    const res = await put({
      items: [
        { id: a.id, keyword: b.keyword, categoryAccountId: a.categoryAccount.id },
        { id: b.id, keyword: a.keyword, categoryAccountId: b.categoryAccount.id },
      ],
    });
    expect(res.status).toBe(200);
    const after = await list();
    expect(after.find((r) => r.id === a.id)!.keyword).toBe(b.keyword);
    expect(after.find((r) => r.id === b.id)!.keyword).toBe(a.keyword);
  });

  it("空のキーワード・重複するキーワードは 400", async () => {
    actingUser = editor;
    expect((await put({ items: [{ keyword: "   ", categoryAccountId: ids.food }] })).status).toBe(
      400,
    );
    const rows = await list();
    const dup = await put({
      items: [
        ...rows.map((r) => ({
          id: r.id,
          keyword: r.keyword,
          categoryAccountId: r.categoryAccount.id,
        })),
        { keyword: rows[0].keyword.toLowerCase(), categoryAccountId: ids.food },
      ],
    });
    expect(dup.status).toBe(400);
  });

  it("他テナントの科目は 404、収入・支出以外の科目は 400、他テナントのルールの id は 404", async () => {
    actingUser = editor;
    expect((await put({ items: [{ keyword: "X", categoryAccountId: ids.foreign }] })).status).toBe(
      404,
    );
    expect((await put({ items: [{ keyword: "X", categoryAccountId: ids.asset }] })).status).toBe(
      400,
    );
    const foreignRule = await prisma.txnCategoryRule.findFirstOrThrow({
      where: { tenantId: otherTenantId },
    });
    expect(
      (await put({ items: [{ id: foreignRule.id, keyword: "X", categoryAccountId: ids.food }] }))
        .status,
    ).toBe(404);
  });
});
