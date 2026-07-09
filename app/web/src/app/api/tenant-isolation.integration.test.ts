/**
 * テナント越境分離 結合テスト（実 DB 使用）
 *
 * 目的: tenantDb() による自動スコープが、実際のルートハンドラ経由で
 *       テナント境界を確実に遮断していることを検証する。
 *       打ち手A（multitenant_audit_report.md）の回帰テストであり、
 *       今回修正した openbanking ルートの回帰テストも兼ねる。
 *
 * 方針:
 *   - 実 DB に 2 テナント（A / B）と各テーブルの行を seed。
 *   - requireRole のみモックし、テナント A のユーザーとして振る舞う。
 *   - 主要な [id] ルートの GET / PUT / DELETE でテナント B の行を要求し、
 *     すべて 404（またはリストに含まれない）ことを確認。
 *   - 対照として自テナント A の行は 200 で取得できることも確認。
 *   - 最後に tenantDb 自体の挙動（findMany / findUnique）も直接検証。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Redis はテスト対象外。キャッシュ系は素通しにする。
vi.mock("@/lib/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// requireRole はモックし、テスト側で「現在のユーザー」を差し替えられるようにする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

// 実ルートハンドラ（tenantDb 経由に移行済み）
import { GET as receivableGet, PUT as receivablePut, DELETE as receivableDelete } from "./receivables/[id]/route";
import { GET as receivableListGet } from "./receivables/route";
import { GET as invoiceGet } from "./invoices/[id]/route";
import { GET as bankTxnGet } from "./bank-accounts/[id]/transactions/route";
import { GET as openbankingGet, POST as openbankingPost } from "./integrations/openbanking/route";

const SUFFIX = `iso_${Date.now()}`;

type Seed = {
  tenantAId: number;
  tenantBId: number;
  userA: { id: number; email: string; name: string; role: string; tenantId: number };
  userB: { id: number; email: string; name: string; role: string; tenantId: number };
  receivableAId: number;
  receivableBId: number;
  invoiceBId: number;
  bankAccountAId: number;
  bankAccountBId: number;
};

let seed: Seed;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body ?? {})),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

// 既存のデモ/seed データが明示 id で挿入されており autoincrement シーケンスが
// 実データより後ろにズレていることがあるため、seed 対象テーブルのシーケンスを
// 現在の最大 id に合わせて補正する（この補正自体は無害）。
async function resyncSequence(table: string) {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
  );
}

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "receivables",
    "invoices",
    "bank_accounts",
    "bank_transactions",
    "audit_logs",
  ]) {
    await resyncSequence(t);
  }

  const tenantA = await prisma.tenant.create({ data: { name: `TenantA_${SUFFIX}` } });
  const tenantB = await prisma.tenant.create({ data: { name: `TenantB_${SUFFIX}` } });

  const userA = await prisma.user.create({
    data: {
      tenantId: tenantA.id,
      email: `a_${SUFFIX}@example.com`,
      name: "User A",
      passwordHash: "x",
      role: "admin",
    },
  });
  const userB = await prisma.user.create({
    data: {
      tenantId: tenantB.id,
      email: `b_${SUFFIX}@example.com`,
      name: "User B",
      passwordHash: "x",
      role: "admin",
    },
  });

  const recA = await prisma.receivable.create({
    data: {
      tenantId: tenantA.id,
      customerName: "顧客A",
      description: "案件A",
      amount: 1000,
      issueDate: new Date("2026-01-01"),
      dueDate: new Date("2026-02-01"),
    },
  });
  const recB = await prisma.receivable.create({
    data: {
      tenantId: tenantB.id,
      customerName: "顧客B",
      description: "案件B",
      amount: 2000,
      issueDate: new Date("2026-01-01"),
      dueDate: new Date("2026-02-01"),
    },
  });

  const invB = await prisma.invoice.create({
    data: {
      tenantId: tenantB.id,
      invoiceNumber: `INV_B_${SUFFIX}`,
      customerName: "顧客B",
      issueDate: new Date("2026-01-01"),
      dueDate: new Date("2026-02-01"),
      subtotal: 1000,
      taxAmount: 100,
      total: 1100,
    },
  });

  const bankA = await prisma.bankAccount.create({
    data: { tenantId: tenantA.id, name: "口座A", bankName: "銀行A" },
  });
  const bankB = await prisma.bankAccount.create({
    data: { tenantId: tenantB.id, name: "口座B", bankName: "銀行B" },
  });
  await prisma.bankTransaction.create({
    data: { accountId: bankB.id, date: new Date("2026-01-05"), description: "B社取引", amount: 500 },
  });

  seed = {
    tenantAId: tenantA.id,
    tenantBId: tenantB.id,
    userA: { id: userA.id, email: userA.email, name: userA.name, role: userA.role, tenantId: tenantA.id },
    userB: { id: userB.id, email: userB.email, name: userB.name, role: userB.role, tenantId: tenantB.id },
    receivableAId: recA.id,
    receivableBId: recB.id,
    invoiceBId: invB.id,
    bankAccountAId: bankA.id,
    bankAccountBId: bankB.id,
  };

  // 既定はテナント A として振る舞う
  actingUser = seed.userA;
});

afterAll(async () => {
  if (!seed) return;
  const tids = [seed.tenantAId, seed.tenantBId];
  // FK 順に削除
  await prisma.bankTransaction.deleteMany({ where: { account: { tenantId: { in: tids } } } });
  await prisma.bankAccount.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.invoiceLine.deleteMany({ where: { invoice: { tenantId: { in: tids } } } });
  await prisma.invoice.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.receivable.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [seed.userA.id, seed.userB.id] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [seed.userA.id, seed.userB.id] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tids } } });
  await prisma.$disconnect();
});

describe("テナント越境分離（テナント A として操作）", () => {
  it("[対照] 自テナント A の receivable は GET できる（200）", async () => {
    const res = await receivableGet(makeReq("GET", "http://x"), params(seed.receivableAId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(seed.receivableAId);
  });

  it("receivable GET: テナント B の行は 404", async () => {
    const res = await receivableGet(makeReq("GET", "http://x"), params(seed.receivableBId));
    expect(res.status).toBe(404);
  });

  it("receivable PUT: テナント B の行は 404、かつ B の行は改ざんされない", async () => {
    const res = await receivablePut(
      makeReq("PUT", "http://x", { customerName: "改ざん" }),
      params(seed.receivableBId),
    );
    expect(res.status).toBe(404);
    const b = await prisma.receivable.findUnique({ where: { id: seed.receivableBId } });
    expect(b?.customerName).toBe("顧客B");
  });

  it("receivable DELETE: テナント B の行は 404、かつ B の行は残存する", async () => {
    const res = await receivableDelete(makeReq("DELETE", "http://x"), params(seed.receivableBId));
    expect(res.status).toBe(404);
    const b = await prisma.receivable.findUnique({ where: { id: seed.receivableBId } });
    expect(b).not.toBeNull();
  });

  it("receivable 一覧: 自テナント A の行のみを返し、B の行は含まれない", async () => {
    const res = await receivableListGet(makeReq("GET", "http://x/api/receivables"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: number[] = body.data.map((r: { id: number }) => r.id);
    expect(ids).toContain(seed.receivableAId);
    expect(ids).not.toContain(seed.receivableBId);
  });

  it("invoice GET: テナント B の請求書は 404", async () => {
    const res = await invoiceGet(makeReq("GET", "http://x"), params(seed.invoiceBId));
    expect(res.status).toBe(404);
  });

  it("bank-accounts/[id]/transactions GET: テナント B の口座は 404", async () => {
    const res = await bankTxnGet(makeReq("GET", "http://x"), params(seed.bankAccountBId));
    expect(res.status).toBe(404);
  });

  it("[回帰] openbanking accounts: 自テナント A の口座のみを返し、B の口座は含まれない", async () => {
    const res = await openbankingGet(
      makeReq("GET", "http://x/api/integrations/openbanking?action=accounts"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: number[] = body.accounts.map((a: { id: number }) => a.id);
    expect(ids).toContain(seed.bankAccountAId);
    expect(ids).not.toContain(seed.bankAccountBId);
  });

  it("[回帰] openbanking POST: テナント B の口座への書き込みは 404", async () => {
    const res = await openbankingPost(
      makeReq("POST", "http://x/api/integrations/openbanking", {
        accountId: seed.bankAccountBId,
        transactions: [],
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("tenantDb 拡張そのものの分離挙動", () => {
  it("findMany はテナント A の行のみを返す", async () => {
    const dbA = tenantDb(seed.tenantAId);
    const rows = await dbA.receivable.findMany();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(seed.receivableAId);
    expect(ids).not.toContain(seed.receivableBId);
  });

  it("findUnique でテナント B の id を指定しても null", async () => {
    const dbA = tenantDb(seed.tenantAId);
    const row = await dbA.receivable.findUnique({ where: { id: seed.receivableBId } });
    expect(row).toBeNull();
  });

  it("create は acting テナントの tenantId を強制する", async () => {
    const dbA = tenantDb(seed.tenantAId);
    // 呼び出し側が別テナント B の tenantId を渡しても A に強制される
    const created = await dbA.receivable.create({
      data: {
        tenantId: seed.tenantBId,
        customerName: "強制テスト",
        description: "強制",
        amount: 1,
        issueDate: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(created.tenantId).toBe(seed.tenantAId);
    await prisma.receivable.delete({ where: { id: created.id } });
  });
});
