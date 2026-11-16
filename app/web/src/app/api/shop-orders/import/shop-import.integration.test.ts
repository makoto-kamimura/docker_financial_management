/**
 * 明細分け（通販の注文）の取り込み（POST /api/shop-orders/import）の結合テスト（実 DB 使用）
 *
 *   - dryRun は書き込まずに、期間・新しく入る件数・取り込み済みの件数を返す
 *   - 取り込むと、商品名の学習ルールで科目が付き、金額と日付の合うカードの明細に自動で紐付く
 *   - 事業利用の明細分けは、ルールが決めていない商品を事業利用で入れる
 *   - 同じ請求（注文番号|発送日）は 2 回目の取り込みで飛ばす
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
import { POST } from "./route";

const SUFFIX = `shopi_${Date.now()}`;
const YEAR = 2094;

const call = (url: string, body: unknown) =>
  POST(
    {
      method: "POST",
      nextUrl: new URL(`http://x${url}`),
      json: () => Promise.resolve(body),
      headers: new Headers({ "Content-Type": "application/json" }),
    } as unknown as import("next/server").NextRequest,
    emptyRouteContext(),
  );

let tenantId: number;
let cardId: number;
let shopId: number;
let bizShopId: number;
let daily: number;
let entryId: number;

const charges = [
  {
    key: "250-1|2094-04-02",
    orderNo: "250-1",
    date: `${YEAR}-04-02`,
    amount: 2_618,
    items: [
      { name: "アタック 洗剤 詰め替え", quantity: 1, amount: 1_078 },
      { name: "文庫本", quantity: 2, amount: 1_540 },
    ],
  },
  {
    key: "250-2|2094-04-10",
    orderNo: "250-2",
    date: `${YEAR}-04-10`,
    amount: 698,
    items: [{ name: "電池", quantity: 1, amount: 698 }],
  },
];

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "financial_records",
    "linked_accounts",
    "shop_accounts",
    "shop_charges",
    "shop_order_items",
    "shop_item_rules",
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
      name: "取込",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  daily = (
    await prisma.account.create({
      data: { tenantId, code: `E1_${SUFFIX}`, name: "日用品", category: "EXPENSE" },
    })
  ).id;
  await prisma.shopItemRule.create({
    data: { tenantId, keyword: "アタック 洗剤", categoryAccountId: daily, priority: 100 },
  });
  cardId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "JAL Global Wallet", type: "PREPAID_CARD", institution: "JAL" },
    })
  ).id;
  shopId = (await prisma.shopAccount.create({ data: { tenantId, name: "Amazon", type: "AMAZON" } }))
    .id;
  bizShopId = (
    await prisma.shopAccount.create({
      data: { tenantId, name: "Amazon（事業）", type: "AMAZON", businessUse: true },
    })
  ).id;
  // 1 件目の請求と金額・日付の合うカードの明細
  entryId = (
    await createTestEntry(
      tenantId,
      { kind: "CARD", accountId: cardId },
      {
        date: new Date(YEAR, 3, 3),
        description: "AMAZON.CO.JP",
        flow: -2_618,
        category: null as never,
      },
    )
  ).id;
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.shopItemRule.deleteMany({ where });
  await prisma.shopOrderItem.deleteMany({ where });
  await prisma.shopCharge.deleteMany({ where });
  await prisma.shopAccount.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where: { tenantId, splitOfId: { not: null } } });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("POST /api/shop-orders/import", () => {
  it("dryRun は書き込まずに件数を返す", async () => {
    const res = await call(`/api/shop-orders/import?shopAccountId=${shopId}&dryRun=1`, { charges });
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toEqual({
      from: `${YEAR}-04-02`,
      to: `${YEAR}-04-10`,
      fresh: 2,
      duplicate: 0,
      items: 3,
    });
    expect(await prisma.shopCharge.count({ where: { tenantId } })).toBe(0);
  });

  it("取り込むと学習ルールで科目が付き、金額と日付の合う明細に自動で紐付く", async () => {
    const res = await call(`/api/shop-orders/import?shopAccountId=${shopId}`, { charges });
    expect(res.status).toBe(201);
    expect((await res.json()).result).toEqual({
      inserted: 2,
      duplicate: 0,
      linked: 1,
      uncategorizedItems: 2,
    });
    const items = await prisma.shopOrderItem.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    });
    expect(items.map((i) => [i.name, i.categoryAccountId, i.businessUse])).toEqual([
      ["アタック 洗剤 詰め替え", daily, false],
      ["文庫本", null, false],
      ["電池", null, false],
    ]);
    const linked = await prisma.shopCharge.findFirstOrThrow({
      where: { externalKey: charges[0].key },
    });
    expect(linked).toMatchObject({ entryId, linkedBy: "AUTO", orderNo: "250-1" });
    // 内訳の行（洗剤は科目あり、文庫本は未割り当て）
    const splits = await prisma.financialRecord.findMany({
      where: { splitOfId: entryId },
      orderBy: { id: "asc" },
    });
    expect(splits.map((r) => [r.accountId, Number(r.amount), Number(r.flow)])).toEqual([
      [daily, 1_078, -1_078],
      [null, 0, -1_540],
    ]);
  });

  it("同じ請求は 2 回目に飛ばす", async () => {
    const res = await call(`/api/shop-orders/import?shopAccountId=${shopId}`, { charges });
    expect((await res.json()).result).toMatchObject({ inserted: 0, duplicate: 2, linked: 0 });
    expect(await prisma.shopCharge.count({ where: { shopAccountId: shopId } })).toBe(2);
  });

  it("事業利用の明細分けは、ルールが決めていない商品を事業利用（100%）で入れる", async () => {
    const res = await call(`/api/shop-orders/import?shopAccountId=${bizShopId}`, {
      charges: [charges[1]],
    });
    expect(res.status).toBe(201);
    const item = await prisma.shopOrderItem.findFirstOrThrow({
      where: { tenantId, charge: { shopAccountId: bizShopId } },
    });
    expect(item.businessUse).toBe(true);
    expect(Number(item.businessRatio)).toBe(100);
  });

  it("ほかのテナントの明細分けや、見出しの無い請求は受け付けない", async () => {
    expect(
      (await call(`/api/shop-orders/import?shopAccountId=999999999`, { charges })).status,
    ).toBe(404);
    expect(
      (await call(`/api/shop-orders/import?shopAccountId=${shopId}`, { charges: [] })).status,
    ).toBe(400);
  });
});
