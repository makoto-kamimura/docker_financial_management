/**
 * 有料プラン（Stripe）の結合テスト（実 DB 使用）
 *
 * - 決済の設定が無ければ、申し込みは 503（準備中）。プランは無料
 * - 申し込み・支払いの管理は管理者だけ
 * - 申し込みで Stripe の顧客と契約の行（申し込みの途中）ができ、Checkout の URL が返る
 * - Stripe の通知（Webhook）は署名を確かめ、同じ通知は二度処理しない
 * - 支払いの完了で有料プラン、支払いの失敗から 7 日は有料プランのまま、解約で無料プラン
 *
 * Stripe の API は、このファイルで立てる偽のサーバーで代用する（STRIPE_API_BASE）。
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

const RANK: Record<string, number> = { viewer: 1, accountant: 2, editor: 3, admin: 4 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    if (RANK[actingUser.role] < RANK[min]) {
      return { error: new Response("forbidden", { status: 403 }) };
    }
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { GET as planGet } from "./plan/route";
import { POST as checkoutPost } from "./checkout-session/route";
import { POST as portalPost } from "./portal-session/route";
import { POST as webhookPost } from "../webhooks/stripe/route";
import { DELETE as tenantDelete } from "../tenants/[id]/route";

const SUFFIX = `bill_${Date.now()}`;
const WEBHOOK_SECRET = "whsec_test_secret";
const DAY = 24 * 60 * 60;

// ── 偽の Stripe ─────────────────────────────────────────────────
type Seen = { path: string; body: URLSearchParams };
const seen: Seen[] = [];
let customerSeq = 0;
const stripeServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const path = req.url ?? "";
    seen.push({ path, body: new URLSearchParams(raw) });
    const reply = (obj: object) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (path === "/v1/customers") {
      return reply({ id: `cus_${SUFFIX}_${++customerSeq}`, object: "customer" });
    }
    if (path === "/v1/checkout/sessions") {
      return reply({ id: "cs_test", object: "checkout.session", url: "https://checkout.test/cs" });
    }
    if (path === "/v1/billing_portal/sessions") {
      return reply({
        id: "bps_test",
        object: "billing_portal.session",
        url: "https://portal.test/p",
      });
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "not found" } }));
  });
});

function enableBilling() {
  const { port } = stripeServer.address() as AddressInfo;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_PRICE_ID = "price_test";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${port}`;
}
function disableBilling() {
  for (const k of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_API_BASE",
  ]) {
    delete process.env[k];
  }
}

// ── リクエスト ─────────────────────────────────────────────────
function apiReq(path: string, method = "GET") {
  return {
    method,
    nextUrl: new URL(`http://localhost:3000${path}`),
    json: () => Promise.resolve({}),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}

let eventSeq = 0;
function webhookReq(type: string, object: object, opts: { created?: number; id?: string } = {}) {
  const payload = JSON.stringify({
    id: opts.id ?? `evt_${SUFFIX}_${++eventSeq}`,
    object: "event",
    type,
    created: opts.created ?? Math.floor(Date.now() / 1000),
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return webhookReqRaw(payload, signature);
}
function webhookReqRaw(payload: string, signature: string) {
  return {
    method: "POST",
    nextUrl: new URL("http://localhost:3000/api/webhooks/stripe"),
    text: () => Promise.resolve(payload),
    headers: new Headers({ "stripe-signature": signature }),
  } as unknown as import("next/server").NextRequest;
}

const subscriptionObject = (customer: string, status: string, extra: object = {}) => ({
  id: `sub_${SUFFIX}`,
  object: "subscription",
  customer,
  status,
  cancel_at_period_end: false,
  canceled_at: null,
  metadata: {},
  items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * DAY }] },
  ...extra,
});

async function plan() {
  const res = await planGet(apiReq("/api/billing/plan"), emptyRouteContext());
  return (await res.json()).data;
}

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;

beforeAll(async () => {
  await new Promise<void>((resolve) => stripeServer.listen(0, "127.0.0.1", resolve));
  for (const t of ["tenants", "users"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  const user = (role: string) =>
    prisma.user.create({
      data: {
        tenantId,
        email: `${role}_${SUFFIX}@example.com`,
        name: role,
        passwordHash: "x",
        role,
      },
    });
  admin = await user("admin");
  editor = await user("editor");
});

afterEach(() => disableBilling());

afterAll(async () => {
  const tids = [tenantId, otherTenantId];
  await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, editor.id] } } });
  await prisma.stripeWebhookEvent.deleteMany({
    where: { eventId: { startsWith: `evt_${SUFFIX}` } },
  });
  await prisma.subscription.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tids } } });
  await prisma.$disconnect();
  stripeServer.close();
});

describe("決済の設定が無いとき", () => {
  it("プランは無料で、申し込みは 503（準備中）", async () => {
    actingUser = admin;
    expect(await plan()).toMatchObject({ plan: "free", billingEnabled: false, subscription: null });

    const res = await checkoutPost(
      apiReq("/api/billing/checkout-session", "POST"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "billing_disabled" });
  });

  it("通知の鍵が無ければ、通知も 503", async () => {
    const res = await webhookPost(webhookReq("invoice.payment_failed", {}));
    expect(res.status).toBe(503);
  });
});

describe("申し込みから解約まで", () => {
  let customerId: string;

  it("管理者以外は申し込めない", async () => {
    enableBilling();
    actingUser = editor;
    const res = await checkoutPost(
      apiReq("/api/billing/checkout-session", "POST"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(403);
  });

  it("申し込むと Stripe の顧客と契約の行（申し込みの途中）ができ、Checkout の URL が返る", async () => {
    enableBilling();
    actingUser = admin;
    seen.length = 0;
    const res = await checkoutPost(
      apiReq("/api/billing/checkout-session", "POST"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.url).toBe("https://checkout.test/cs");

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("INCOMPLETE");
    customerId = sub.stripeCustomerId;

    const cs = seen.find((s) => s.path === "/v1/checkout/sessions")!;
    expect(cs.body.get("customer")).toBe(customerId);
    expect(cs.body.get("line_items[0][price]")).toBe("price_test");
    expect(cs.body.get("subscription_data[metadata][tenant_id]")).toBe(String(tenantId));
    expect(cs.body.get("success_url")).toBe(
      "http://localhost:3000/settings?tab=billing&checkout=success",
    );
    // 申し込みの途中はまだ無料プラン
    expect((await plan()).plan).toBe("free");
  });

  it("署名が正しくない通知は 400 で、何も変えない", async () => {
    enableBilling();
    const payload = JSON.stringify({ id: `evt_${SUFFIX}_bad`, type: "checkout.session.completed" });
    const res = await webhookPost(webhookReqRaw(payload, "t=1,v1=bad"));
    expect(res.status).toBe(400);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("INCOMPLETE");
  });

  it("支払いが済むと有料プランになる", async () => {
    enableBilling();
    const res = await webhookPost(
      webhookReq("checkout.session.completed", {
        id: "cs_test",
        object: "checkout.session",
        customer: customerId,
        subscription: `sub_${SUFFIX}`,
        payment_status: "paid",
      }),
    );
    expect(res.status).toBe(200);
    actingUser = admin;
    const p = await plan();
    expect(p).toMatchObject({ plan: "premium", billingEnabled: true });
    expect(p.subscription.status).toBe("ACTIVE");
  });

  it("有料プランのテナントは、もう一度申し込めない（409）", async () => {
    enableBilling();
    actingUser = admin;
    const res = await checkoutPost(
      apiReq("/api/billing/checkout-session", "POST"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(409);
  });

  it("有料プランの契約があるテナントは削除できない（409）", async () => {
    actingUser = admin;
    const res = await tenantDelete(apiReq(`/api/tenants/${tenantId}`, "DELETE"), {
      params: Promise.resolve({ id: String(tenantId) }),
    });
    expect(res.status).toBe(409);
    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
  });

  it("支払いの管理の画面の URL が返る", async () => {
    enableBilling();
    actingUser = admin;
    const res = await portalPost(
      apiReq("/api/billing/portal-session", "POST"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.url).toBe("https://portal.test/p");
  });

  it("支払いに失敗しても 7 日は有料プラン。同じ通知は二度処理しない", async () => {
    enableBilling();
    const created = Math.floor(Date.now() / 1000) - 2 * DAY;
    const id = `evt_${SUFFIX}_pastdue`;
    const obj = subscriptionObject(customerId, "past_due");
    expect(
      (await webhookPost(webhookReq("customer.subscription.updated", obj, { id, created }))).status,
    ).toBe(200);
    // 同じ通知が、別の日時で送り直されても起点は変わらない
    expect(
      (
        await webhookPost(
          webhookReq("customer.subscription.updated", obj, { id, created: created + DAY }),
        )
      ).status,
    ).toBe(200);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("PAST_DUE");
    expect(sub.pastDueSince?.getTime()).toBe(created * 1000);
    expect(await prisma.stripeWebhookEvent.count({ where: { eventId: id } })).toBe(1);
    actingUser = admin;
    expect((await plan()).plan).toBe("premium");
  });

  it("猶予の 7 日を過ぎると無料プラン。支払いが戻れば有料プランに戻る", async () => {
    enableBilling();
    await prisma.subscription.update({
      where: { tenantId },
      data: { pastDueSince: new Date(Date.now() - 8 * DAY * 1000) },
    });
    actingUser = admin;
    expect((await plan()).plan).toBe("free");

    await webhookPost(
      webhookReq("customer.subscription.updated", subscriptionObject(customerId, "active")),
    );
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub).toMatchObject({ status: "ACTIVE", pastDueSince: null });
    expect(sub.currentPeriodEnd).not.toBeNull();
    expect((await plan()).plan).toBe("premium");
  });

  it("解約の通知で無料プランに戻る", async () => {
    enableBilling();
    await webhookPost(
      webhookReq("customer.subscription.deleted", subscriptionObject(customerId, "canceled")),
    );
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe("CANCELED");
    expect(sub.canceledAt).not.toBeNull();
    actingUser = admin;
    expect((await plan()).plan).toBe("free");
  });
});

describe("申し込みの画面を経ていない契約", () => {
  it("メタデータのテナントに結び付ける", async () => {
    enableBilling();
    const customer = `cus_${SUFFIX}_dashboard`;
    await webhookPost(
      webhookReq(
        "customer.subscription.created",
        subscriptionObject(customer, "active", {
          id: `sub_${SUFFIX}_dash`,
          metadata: { tenant_id: String(otherTenantId) },
        }),
      ),
    );
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: otherTenantId } });
    expect(sub).toMatchObject({ stripeCustomerId: customer, status: "ACTIVE" });
  });
});
