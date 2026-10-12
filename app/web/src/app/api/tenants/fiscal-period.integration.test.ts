/**
 * 会計期間（開始月・決算月）結合テスト（実 DB 使用）
 *
 *   - 開始月は決算月の翌月でなければ保存できない（API は 400、DB は CHECK 制約で拒否）
 *   - 期の最初の月（開始月）は、前月の実績が未確定でも予算を確定できる。それ以外の月は今までどおり 409
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { PUT as tenantPut } from "./[id]/route";
import { POST as budgetConfirmPost } from "../budgets/confirm/route";
import { GET as cycleStatusGet } from "../cycle-status/route";

const SUFFIX = `fp_${Date.now()}`;
const YEAR = 2096; // 他のテストと衝突しない専用の年度

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

let tenantId: number;
let editor: { id: number; email: string; name: string; role: string; tenantId: number };

const putMonths = (body: { startMonth?: number; closingMonth?: number }) =>
  tenantPut(makeReq("PUT", `http://x/api/tenants/${tenantId}`, body), {
    params: Promise.resolve({ id: String(tenantId) }),
  });
const confirmBudget = (month: number) =>
  budgetConfirmPost(
    makeReq("POST", "http://x/api/budgets/confirm", { year: YEAR, month, items: [] }),
    emptyRouteContext(),
  );
async function cycleStatus(month: number) {
  const res = await cycleStatusGet(
    makeReq("GET", `http://x/api/cycle-status?year=${YEAR}&month=${month}`),
    emptyRouteContext(),
  );
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

beforeAll(async () => {
  for (const t of ["tenants", "users", "periods"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  editor = await prisma.user.create({
    data: {
      tenantId,
      email: `editor_${SUFFIX}@example.com`,
      name: "editor",
      passwordHash: "x",
      role: "editor",
    },
  });
  actingUser = editor;
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: editor.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("会計期間の保存", () => {
  it("既定は 1 月開始・12 月決算", async () => {
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(t).toMatchObject({ startMonth: 1, closingMonth: 12 });
  });

  it("開始月が決算月の翌月でなければ 400", async () => {
    const res = await putMonths({ startMonth: 5, closingMonth: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("開始月は決算月（3月）の翌月の4月にしてください");
  });

  it("どちらか一方だけでは 400", async () => {
    expect((await putMonths({ closingMonth: 3 })).status).toBe(400);
    expect((await putMonths({ startMonth: 4 })).status).toBe(400);
  });

  it("対応していれば保存できる（4 月開始・3 月決算）", async () => {
    const res = await putMonths({ startMonth: 4, closingMonth: 3 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ startMonth: 4, closingMonth: 3 });
  });

  it("DB に直接入れても CHECK 制約で拒否される", async () => {
    await expect(
      prisma.tenant.update({ where: { id: tenantId }, data: { startMonth: 5 } }),
    ).rejects.toThrow();
  });
});

describe("開始月の予算の確定", () => {
  it("開始月（4 月）は、3 月の実績が未確定でも予算を確定できる", async () => {
    // 3 月の予算は確定済み・実績は未確定（ふつうなら 4 月の予算は確定できない状態）
    expect((await confirmBudget(3)).status).toBe(201);
    const april = await cycleStatus(4);
    expect(april.fiscalStart).toBe(true);
    expect(april.prevActualsPending).toBe(false);
    expect((await confirmBudget(4)).status).toBe(201);
  });

  it("開始月以外（5 月）は、4 月の実績が未確定なら今までどおり 409", async () => {
    const may = await cycleStatus(5);
    expect(may.fiscalStart).toBe(false);
    expect(may.prevActualsPending).toBe(true);
    const res = await confirmBudget(5);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("実績が確定していません");
  });
});
