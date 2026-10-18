/**
 * 明細ページの URL（statementUrl） 結合テスト（実 DB 使用）
 *
 * 銀行口座・カードに、明細を見る公式サイトの URL を登録・変更・消去できること。
 * https 以外は受けない。PATCH で省略したときは変えない。
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
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
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { POST as bankPost } from "./route";
import { PATCH as bankPatch } from "./[id]/route";
import { POST as cardPost } from "../linked-accounts/route";
import { PATCH as cardPatch } from "../linked-accounts/[id]/route";

const SUFFIX = `su_${Date.now()}`;

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

beforeAll(async () => {
  for (const t of ["tenants", "users", "bank_accounts", "linked_accounts"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  actingUser = await prisma.user.create({
    data: {
      tenantId,
      email: `editor_${SUFFIX}@example.com`,
      name: "e",
      passwordHash: "x",
      role: "editor",
    },
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("銀行口座の明細ページの URL", () => {
  it("登録 → 省略した PATCH では変わらない → 空欄で消える", async () => {
    const created = await bankPost(
      makeReq("POST", "/api/bank-accounts", {
        name: "給与口座",
        bankName: "テスト銀行",
        statementUrl: "https://bank.example.com/login",
      }),
      emptyRouteContext(),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id as number;
    expect((await prisma.bankAccount.findUnique({ where: { id } }))?.statementUrl).toBe(
      "https://bank.example.com/login",
    );

    await bankPatch(makeReq("PATCH", `/api/bank-accounts/${id}`, { note: "メモ" }), params(id));
    expect((await prisma.bankAccount.findUnique({ where: { id } }))?.statementUrl).toBe(
      "https://bank.example.com/login",
    );

    const cleared = await bankPatch(
      makeReq("PATCH", `/api/bank-accounts/${id}`, { statementUrl: "" }),
      params(id),
    );
    expect(cleared.status).toBe(200);
    expect((await prisma.bankAccount.findUnique({ where: { id } }))?.statementUrl).toBeNull();
  });

  it("https 以外は 400", async () => {
    const res = await bankPost(
      makeReq("POST", "/api/bank-accounts", {
        name: "別口座",
        bankName: "テスト銀行",
        statementUrl: "javascript:alert(1)",
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(400);
  });
});

describe("カードの明細ページの URL", () => {
  it("登録と変更", async () => {
    const created = await cardPost(
      makeReq("POST", "/api/linked-accounts", {
        name: "テストカード",
        institution: "テストカード会社",
        statementUrl: "https://card.example.com/",
      }),
      emptyRouteContext(),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id as number;

    await cardPatch(
      makeReq("PATCH", `/api/linked-accounts/${id}`, {
        statementUrl: "https://card.example.com/statement",
      }),
      params(id),
    );
    expect((await prisma.linkedAccount.findUnique({ where: { id } }))?.statementUrl).toBe(
      "https://card.example.com/statement",
    );
  });
});
