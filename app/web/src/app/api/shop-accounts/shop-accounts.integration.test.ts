/**
 * 明細管理（明細分け。/api/shop-accounts）の結合テスト（実 DB 使用）
 *
 *   - 登録・一覧・更新・削除（種類・キーワード・支払いに使うカード／口座）
 *   - 一覧の件数（請求・未紐付け・科目なしの商品）
 *   - ほかのテナントのカードは支払いに選べない（400）
 *   - 取り込んだ注文がある明細分けは削除できない（409）
 *   - scope=business は事業利用のものだけ
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
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

const SUFFIX = `shop_${Date.now()}`;

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
let otherTenantId: number;
let cardId: number;
let otherCardId: number;
let accountId: number;

beforeAll(async () => {
  for (const t of ["tenants", "users", "linked_accounts", "shop_accounts", "accounts"]) {
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
      name: "明細",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  cardId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "JAL Global Wallet", type: "PREPAID_CARD", institution: "JAL" },
    })
  ).id;
  otherCardId = (
    await prisma.linkedAccount.create({
      data: {
        tenantId: otherTenantId,
        name: "他人のカード",
        type: "CREDIT_CARD",
        institution: "X",
      },
    })
  ).id;
  accountId = (
    await prisma.account.create({
      data: { tenantId, code: `E_${SUFFIX}`, name: "日用品", category: "EXPENSE" },
    })
  ).id;
});

afterAll(async () => {
  for (const t of [tenantId, otherTenantId]) {
    if (!t) continue;
    const where = { tenantId: t };
    await prisma.shopOrderItem.deleteMany({ where });
    await prisma.shopCharge.deleteMany({ where });
    await prisma.shopAccount.deleteMany({ where });
    await prisma.linkedAccount.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.tenant.delete({ where: { id: t } });
  }
  await prisma.$disconnect();
});

describe("/api/shop-accounts", () => {
  let shopId: number;

  it("登録すると、キーワードと支払いのカードを持つ", async () => {
    const res = await call(POST, "/api/shop-accounts", "POST", {
      name: "Amazon",
      type: "AMAZON",
      paymentCardIds: [cardId],
      statementUrl: "",
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    shopId = data.id;
    expect(data).toMatchObject({
      tenantId,
      type: "AMAZON",
      matchKeywords: [],
      paymentCardIds: [cardId],
      statementUrl: null,
      businessUse: false,
    });
  });

  it("ほかのテナントのカードは支払いに選べない", async () => {
    const res = await call(POST, "/api/shop-accounts", "POST", {
      name: "楽天市場",
      type: "RAKUTEN",
      paymentCardIds: [otherCardId],
    });
    expect(res.status).toBe(400);
  });

  it("一覧に、請求・未紐付け・科目なしの商品の件数を添える", async () => {
    const charge = (key: string) =>
      prisma.shopCharge.create({
        data: {
          tenantId,
          shopAccountId: shopId,
          orderNo: key,
          date: new Date("2026-11-01"),
          amount: 3_000,
          externalKey: key,
        },
      });
    const a = await charge("A");
    const b = await charge("B");
    await prisma.shopOrderItem.createMany({
      data: [
        { tenantId, chargeId: a.id, name: "洗剤", amount: 1_000, categoryAccountId: accountId },
        { tenantId, chargeId: a.id, name: "本", amount: 2_000 },
        { tenantId, chargeId: b.id, name: "電池", amount: 3_000 },
      ],
    });

    const res = await call(GET, "/api/shop-accounts");
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: shopId,
      chargeCount: 2,
      unlinkedCount: 2,
      uncategorizedCount: 2,
    });
    expect(data[0].lastImportedAt).not.toBeNull();
  });

  it("更新でキーワードと事業利用を変えられる", async () => {
    const res = await call(
      PATCH,
      `/api/shop-accounts/${shopId}`,
      "PATCH",
      { matchKeywords: ["AMZN"], excludeKeywords: ["PRIME"], businessUse: true, note: null },
      shopId,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      matchKeywords: ["AMZN"],
      excludeKeywords: ["PRIME"],
      businessUse: true,
    });

    const business = await (await call(GET, "/api/shop-accounts?scope=business")).json();
    expect(business.data.map((a: { id: number }) => a.id)).toEqual([shopId]);
  });

  it("取り込んだ注文があれば削除できない。注文を消せば削除できる", async () => {
    expect(
      (await call(DELETE, `/api/shop-accounts/${shopId}`, "DELETE", undefined, shopId)).status,
    ).toBe(409);
    await prisma.shopCharge.deleteMany({ where: { shopAccountId: shopId } });
    expect(
      (await call(DELETE, `/api/shop-accounts/${shopId}`, "DELETE", undefined, shopId)).status,
    ).toBe(204);
    expect(await prisma.shopOrderItem.count({ where: { tenantId } })).toBe(0);
  });
});
