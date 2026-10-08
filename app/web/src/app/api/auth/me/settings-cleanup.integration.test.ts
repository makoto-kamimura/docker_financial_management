/**
 * 設定の整理 結合テスト（実 DB 使用）
 *
 * - PATCH /api/auth/me … 自分の表示名だけが変わり、監査ログに残る
 * - GET /api/audit-logs … 自分のテナントの記録だけを、今の表示名つきで返す
 * - POST /api/actuals … 現金の明細を科目つきで作る（実績のカレンダーの「現金」。その行がそのまま実績）
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
import { PATCH as mePatch } from "./route";
import { GET as auditGet } from "../../audit-logs/route";
import { POST as actualsPost } from "../../actuals/route";

const SUFFIX = `sc_${Date.now()}`;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
let foodCode: string;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "journal_entries", "audit_logs"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  admin = await prisma.user.create({
    data: {
      tenantId,
      email: `a_${SUFFIX}@example.com`,
      name: "管理者",
      passwordHash: "x",
      role: "admin",
    },
  });
  viewer = await prisma.user.create({
    data: {
      tenantId,
      email: `v_${SUFFIX}@example.com`,
      name: "閲覧者",
      passwordHash: "x",
      role: "viewer",
    },
  });
  // 別のテナントの記録（監査ログに出てはいけない）
  await prisma.auditLog.create({
    data: { tenantId: otherTenantId, userId: null, action: "login", target: `other:${SUFFIX}` },
  });
  foodCode = `E${SUFFIX}`;
  await prisma.account.createMany({
    data: [
      { tenantId, code: foodCode, name: "食費", category: "EXPENSE" },
      { tenantId, code: `C${SUFFIX}`, name: "現金", category: "ASSET" },
    ],
  });
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    const where = { tenantId: id };
    await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId: id } } });
    await prisma.financialRecord.deleteMany({ where });
    await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId: id } } });
    await prisma.journalEntry.deleteMany({ where });
    await prisma.period.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.tenant.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("PATCH /api/auth/me", () => {
  it("自分の表示名だけが変わり、監査ログに変更前と変更後が残る", async () => {
    actingUser = viewer;
    const res = await mePatch(
      makeReq("PATCH", "http://x/api/auth/me", { name: "  家計の係  " }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: viewer.id } })).name).toBe(
      "家計の係",
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).name).toBe("管理者");
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "update_profile" },
    });
    expect(JSON.parse(log.before ?? "{}")).toEqual({ name: "閲覧者" });
    expect(JSON.parse(log.after ?? "{}")).toEqual({ name: "家計の係" });
  });

  it("空の表示名は受け付けない", async () => {
    actingUser = viewer;
    const res = await mePatch(
      makeReq("PATCH", "http://x/api/auth/me", { name: "   " }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/audit-logs", () => {
  it("自分のテナントの記録だけを、今の表示名つきで返す", async () => {
    actingUser = admin;
    const res = await auditGet(makeReq("GET", "http://x/api/audit-logs"), emptyRouteContext());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.every((l: { tenantId: number }) => l.tenantId === tenantId)).toBe(true);
    const profile = data.find((l: { action: string }) => l.action === "update_profile");
    expect(profile.userName).toBe("家計の係");
  });
});

describe("POST /api/actuals", () => {
  it("現金の明細を科目つきで作り、その行がそのまま実績になる", async () => {
    actingUser = admin;
    const res = await actualsPost(
      makeReq("POST", "http://x/api/actuals", {
        date: "2031-03-10",
        description: "八百屋",
        accountCode: foodCode,
        amount: 1200,
        direction: "expense",
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ amount: -1200, description: "八百屋" });
    const row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: data.id } });
    expect([row.kind, Number(row.flow), Number(row.amount)]).toEqual(["CASH", -1200, 1200]);
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);
  });
});
