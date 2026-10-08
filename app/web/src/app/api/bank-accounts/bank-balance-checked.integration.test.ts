/**
 * 口座の差額を確かめたかどうか 結合テスト（実 DB 使用）
 *
 * 差額 0 円を保存しても「差額を入力」の案内が消えなかったため、保存したら（0 円でも）
 * balanceCheckedAt を入れる。既存の口座で差額が 0 でないものは、マイグレーションで確かめ済みにする。
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
import { GET as listGet } from "./route";
import { PATCH as accountPatch } from "./[id]/route";

const SUFFIX = `bc_${Date.now()}`;

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
let bankId: number;

beforeAll(async () => {
  for (const t of ["tenants", "users", "bank_accounts"]) {
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
  const bank = await prisma.bankAccount.create({
    data: { tenantId, name: "給与口座", bankName: "テスト銀行" },
  });
  bankId = bank.id;
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("差額を確かめたかどうか", () => {
  it("差額 0 円で保存しても確かめ済みになり、一覧に返る", async () => {
    const before = (
      await (
        await listGet(makeReq("GET", "http://x/api/bank-accounts"), emptyRouteContext())
      ).json()
    ).data[0];
    expect(before.balanceCheckedAt).toBeNull();

    const res = await accountPatch(
      makeReq("PATCH", `http://x/api/bank-accounts/${bankId}`, { balanceAdjustment: 0 }),
      params(bankId),
    );
    expect(res.status).toBe(200);
    const after = (
      await (
        await listGet(makeReq("GET", "http://x/api/bank-accounts"), emptyRouteContext())
      ).json()
    ).data[0];
    expect(after.balanceAdjustment).toBe(0);
    expect(after.balanceCheckedAt).not.toBeNull();
  });

  it("名前だけ直したときは確かめ済みにしない", async () => {
    const other = await prisma.bankAccount.create({
      data: { tenantId, name: "貯蓄口座", bankName: "テスト銀行" },
    });
    await accountPatch(
      makeReq("PATCH", `http://x/api/bank-accounts/${other.id}`, { name: "貯蓄口座2" }),
      params(other.id),
    );
    expect(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: other.id } })).balanceCheckedAt,
    ).toBeNull();
  });

  it("マイグレーション: 差額が 0 でない既存の口座は確かめ済みにする", async () => {
    const legacy = await prisma.bankAccount.create({
      data: { tenantId, name: "古い口座", bankName: "テスト銀行", balanceAdjustment: 12_345 },
    });
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261012120000_bank_balance_checked/migration.sql",
      ),
      "utf8",
    );
    const update = sql
      .split(";")
      .map((st) => st.replace(/--.*$/gm, "").trim())
      .find((st) => st.startsWith("UPDATE"));
    await prisma.$executeRawUnsafe(update!);
    expect(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: legacy.id } })).balanceCheckedAt,
    ).not.toBeNull();
  });
});
