/**
 * 明細分けの商品名の学習ルール（/api/shop-item-rules）と、科目の削除の結合テスト（実 DB 使用）
 *
 *   - 一覧・キーワードの書き換え（正規化・重複は 409）・科目の付け替え（収入・支出の科目だけ）・削除
 *   - 明細分けの商品に使われている科目は削除できない。ルールだけに使われている科目は、ルールと一緒に消える
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
import { GET } from "./route";
import { PATCH, DELETE } from "./[id]/route";
import { DELETE as accountDelete } from "../accounts/[id]/route";

const SUFFIX = `shopr_${Date.now()}`;

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const call = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: any, ctx: any) => Promise<Response>,
  url: string,
  method = "GET",
  body?: unknown,
  id?: number,
) =>
  handler(
    makeReq(`http://x${url}`, method, body),
    id === undefined ? emptyRouteContext() : { params: Promise.resolve({ id: String(id) }) },
  );

let tenantId: number;
let daily: number;
let books: number;
let cash: number;
let ruleA: number;
let ruleB: number;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "shop_item_rules",
    "shop_accounts",
    "shop_charges",
    "shop_order_items",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "規則",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  const acct = async (code: string, name: string, category: "EXPENSE" | "ASSET") =>
    (await prisma.account.create({ data: { tenantId, code: `${code}_${SUFFIX}`, name, category } }))
      .id;
  daily = await acct("E1", "日用品", "EXPENSE");
  books = await acct("E2", "書籍", "EXPENSE");
  cash = await acct("A1", "現金", "ASSET");
  ruleA = (
    await prisma.shopItemRule.create({
      data: {
        tenantId,
        keyword: "アタック 洗剤 詰め替え 大容量",
        categoryAccountId: daily,
        priority: 100,
      },
    })
  ).id;
  ruleB = (
    await prisma.shopItemRule.create({
      data: { tenantId, keyword: "文庫", categoryAccountId: books, priority: 100 },
    })
  ).id;
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.shopItemRule.deleteMany({ where });
  await prisma.shopOrderItem.deleteMany({ where });
  await prisma.shopCharge.deleteMany({ where });
  await prisma.shopAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("/api/shop-item-rules", () => {
  it("キーワード順に一覧を返す", async () => {
    const { data } = await (await call(GET, "/api/shop-item-rules")).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(data.map((r: any) => [r.keyword, r.categoryAccount.id])).toEqual([
      ["アタック 洗剤 詰め替え 大容量", daily],
      ["文庫", books],
    ]);
  });

  it("キーワードを短く直せる。同じキーワードは 409、収入・支出でない科目は 400", async () => {
    const res = await call(
      PATCH,
      `/api/shop-item-rules/${ruleA}`,
      "PATCH",
      { keyword: "  アタック  洗剤 " },
      ruleA,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.keyword).toBe("アタック 洗剤");

    const dup = await call(
      PATCH,
      `/api/shop-item-rules/${ruleB}`,
      "PATCH",
      { keyword: "アタック 洗剤" },
      ruleB,
    );
    expect(dup.status).toBe(409);
    const bad = await call(
      PATCH,
      `/api/shop-item-rules/${ruleB}`,
      "PATCH",
      { categoryAccountId: cash },
      ruleB,
    );
    expect(bad.status).toBe(400);
    const moved = await call(
      PATCH,
      `/api/shop-item-rules/${ruleB}`,
      "PATCH",
      { categoryAccountId: daily },
      ruleB,
    );
    expect((await moved.json()).data.categoryAccountId).toBe(daily);
  });

  it("消せる", async () => {
    expect(
      (await call(DELETE, `/api/shop-item-rules/${ruleB}`, "DELETE", undefined, ruleB)).status,
    ).toBe(204);
    expect(await prisma.shopItemRule.count({ where: { tenantId } })).toBe(1);
  });
});

describe("科目の削除", () => {
  it("明細分けの商品に使われている科目は消せない。ルールだけなら、ルールと一緒に消える", async () => {
    const shop = await prisma.shopAccount.create({
      data: { tenantId, name: "Amazon", type: "AMAZON" },
    });
    await prisma.shopCharge.create({
      data: {
        tenantId,
        shopAccountId: shop.id,
        orderNo: "X",
        date: new Date("2093-01-01"),
        amount: 500,
        externalKey: "X",
        items: { create: [{ tenantId, name: "文庫本", amount: 500, categoryAccountId: books }] },
      },
    });
    await prisma.shopItemRule.create({
      data: { tenantId, keyword: "雑誌", categoryAccountId: books },
    });
    expect(
      (await call(accountDelete, `/api/accounts/${books}`, "DELETE", undefined, books)).status,
    ).toBe(409);

    // 日用品はルールだけに使われている
    expect(
      (await call(accountDelete, `/api/accounts/${daily}`, "DELETE", undefined, daily)).status,
    ).toBe(204);
    expect(await prisma.shopItemRule.count({ where: { tenantId, categoryAccountId: daily } })).toBe(
      0,
    );
  });
});
