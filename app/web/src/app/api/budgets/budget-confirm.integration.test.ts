/**
 * 予算の月次サイクル 結合テスト（実 DB 使用）
 *
 * 予実対比（GET /api/budgets/variance）→ 翌月の予算案を確定（POST /api/budgets/confirm）
 * → 確定した月は予算を書き換えられない → 解除（admin のみ）で再び編集できる、を
 * 実際のルートハンドラ経由で確かめる。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// requireRole はモックし、テスト側で「現在のユーザー」を差し替える（権限の順位は本物と同じ）
const RANK: Record<string, number> = { viewer: 1, accountant: 2, editor: 3, admin: 4 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    if ((RANK[actingUser.role] ?? 0) < RANK[min]) {
      return { error: new Response("forbidden", { status: 403 }) };
    }
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/prisma";
import { emptyRouteContext } from "@/lib/api-handler";
import { GET as varianceGet } from "./variance/route";
import { POST as confirmPost, DELETE as confirmDelete } from "./confirm/route";
import { GET as budgetsGet, POST as budgetsPost } from "./route";
import { PATCH as budgetPatch, DELETE as budgetDelete } from "./[id]/route";
import { POST as allocationApplyPost } from "./allocation-apply/route";
import { POST as importPost } from "./import/route";

const SUFFIX = `bc_${Date.now()}`;
const YEAR = 2098; // 他のテストと衝突しない専用の年度

function makeReq(method: string, url: string, body?: unknown, form?: FormData) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    formData: () => Promise.resolve(form ?? new FormData()),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let admin: { id: number; email: string; name: string; role: string; tenantId: number };
let editor: typeof admin;
let food: { id: number; code: string };
let leisure: { id: number; code: string };
let savings: { id: number; code: string };
let salary: { id: number; code: string };

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "budgets", "audit_logs"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const mkUser = (role: string) =>
    prisma.user.create({
      data: {
        tenantId,
        email: `${role}_${SUFFIX}@example.com`,
        name: role,
        passwordHash: "x",
        role,
      },
    });
  admin = await mkUser("admin");
  editor = await mkUser("editor");

  const mkAccount = (code: string, name: string, category: "REVENUE" | "EXPENSE") =>
    prisma.account.create({ data: { tenantId, code: `${code}_${SUFFIX}`, name, category } });
  food = await mkAccount("F", "食費", "EXPENSE");
  leisure = await mkAccount("L", "娯楽費", "EXPENSE");
  savings = await mkAccount("S", "貯蓄", "EXPENSE");
  salary = await mkAccount("R", "給与", "REVENUE");

  await prisma.allocationRule.create({
    data: {
      tenantId,
      key: "savings",
      label: "貯蓄・投資",
      group: "その他",
      minPercent: 20,
      accountId: savings.id,
    },
  });

  const may = await prisma.period.create({
    data: { tenantId, fiscalYear: YEAR, month: 5, quarter: 2 },
  });
  await prisma.budget.createMany({
    data: [
      { tenantId, accountId: food.id, periodId: may.id, amount: 50_000 },
      { tenantId, accountId: leisure.id, periodId: may.id, amount: 20_000 },
      { tenantId, accountId: salary.id, periodId: may.id, amount: 300_000 },
    ],
  });
  await prisma.financialRecord.createMany({
    data: [
      { tenantId, accountId: food.id, periodId: may.id, amount: 42_000 },
      { tenantId, accountId: leisure.id, periodId: may.id, amount: 26_000 },
      { tenantId, accountId: salary.id, periodId: may.id, amount: 300_000 },
    ],
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.allocationRule.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, editor.id] } } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("予算の月次サイクル", () => {
  it("予実対比: 科目ごとの差と、余りの回し先の既定を返す", async () => {
    actingUser = editor;
    const res = await varianceGet(
      makeReq("GET", `http://x/api/budgets/variance?year=${YEAR}&month=5`),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.next).toEqual({ year: YEAR, month: 6 });
    expect(data.confirmedAt).toBeNull();
    expect(data.transferTargetId).toBe(savings.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<number, any>(data.rows.map((r: any) => [r.accountId, r]));
    expect(byId.get(food.id)).toMatchObject({ plan: 50_000, actual: 42_000, difference: -8_000 });
    expect(byId.get(food.id).surplus).toBe(true);
    expect(byId.get(leisure.id)).toMatchObject({ difference: 6_000, favorable: false });
    expect(byId.has(savings.id)).toBe(false); // 予算も実績も無い科目は出さない
    expect(data.summary.surplusTotal).toBe(8_000);
    expect(data.summary.overrunTotal).toBe(6_000);
  });

  it("翌月の予算案を書き込んで確定する", async () => {
    actingUser = editor;
    const res = await confirmPost(
      makeReq("POST", "http://x/api/budgets/confirm", {
        year: YEAR,
        month: 6,
        items: [
          { accountId: food.id, amount: 50_000 },
          { accountId: leisure.id, amount: 20_000 },
          { accountId: savings.id, amount: 8_000 },
          { accountId: salary.id, amount: 300_000 },
        ],
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data.written).toBe(4);

    const june = await prisma.budget.findMany({
      where: { tenantId, period: { fiscalYear: YEAR, month: 6 } },
    });
    expect(june.find((b) => b.accountId === savings.id)?.amount.toNumber()).toBe(8_000);
    const histories = await prisma.budgetHistory.count({
      where: { tenantId, period: { fiscalYear: YEAR, month: 6 } },
    });
    expect(histories).toBe(4);

    const list = await budgetsGet(
      makeReq("GET", `http://x/api/budgets?year=${YEAR}`),
      emptyRouteContext(),
    );
    expect((await list.json()).confirmedMonths).toEqual([6]);
  });

  it("確定済みの月は二重に確定できない", async () => {
    actingUser = editor;
    const res = await confirmPost(
      makeReq("POST", "http://x/api/budgets/confirm", { year: YEAR, month: 6 }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(409);
  });

  it("確定済みの月の予算は、登録・変更・削除・配分の反映・CSV 取込のどれでも変えられない", async () => {
    actingUser = editor;
    const june = await prisma.budget.findFirstOrThrow({
      where: { tenantId, accountId: food.id, period: { fiscalYear: YEAR, month: 6 } },
    });

    const post = await budgetsPost(
      makeReq("POST", "http://x/api/budgets", {
        accountCode: leisure.code,
        fiscalYear: YEAR,
        month: 6,
        amount: 1,
      }),
      emptyRouteContext(),
    );
    expect(post.status).toBe(409);

    const patch = await budgetPatch(
      makeReq("PATCH", `http://x/api/budgets/${june.id}`, { amount: 1 }),
      params(june.id),
    );
    expect(patch.status).toBe(409);

    const del = await budgetDelete(
      makeReq("DELETE", `http://x/api/budgets/${june.id}`),
      params(june.id),
    );
    expect(del.status).toBe(409);

    const apply = await allocationApplyPost(
      makeReq("POST", "http://x/api/budgets/allocation-apply", {
        year: YEAR,
        items: [{ accountId: food.id, month: 6, amount: 1 }],
      }),
      emptyRouteContext(),
    );
    expect(apply.status).toBe(409);

    const form = new FormData();
    form.append(
      "file",
      new File([`accountCode,fiscalYear,month,amount\n${food.code},${YEAR},6,1\n`], "b.csv"),
    );
    const imp = await importPost(
      makeReq("POST", "http://x/api/budgets/import", undefined, form),
      emptyRouteContext(),
    );
    expect(imp.status).toBe(200);
    const impBody = await imp.json();
    expect(impBody.imported).toBe(0);
    expect(impBody.errors[0]).toContain("確定済み");

    const after = await prisma.budget.findUniqueOrThrow({ where: { id: june.id } });
    expect(after.amount.toNumber()).toBe(50_000);
  });

  it("確定していない月は、これまでどおり変更できる", async () => {
    actingUser = editor;
    const may = await prisma.budget.findFirstOrThrow({
      where: { tenantId, accountId: food.id, period: { fiscalYear: YEAR, month: 5 } },
    });
    const patch = await budgetPatch(
      makeReq("PATCH", `http://x/api/budgets/${may.id}`, { amount: 51_000 }),
      params(may.id),
    );
    expect(patch.status).toBe(200);
  });

  it("確定の解除は admin だけができ、解除すると再び変更できる", async () => {
    actingUser = editor;
    const denied = await confirmDelete(
      makeReq("DELETE", `http://x/api/budgets/confirm?year=${YEAR}&month=6`),
      emptyRouteContext(),
    );
    expect(denied.status).toBe(403);

    actingUser = admin;
    const ok = await confirmDelete(
      makeReq("DELETE", `http://x/api/budgets/confirm?year=${YEAR}&month=6`),
      emptyRouteContext(),
    );
    expect(ok.status).toBe(204);

    const again = await confirmDelete(
      makeReq("DELETE", `http://x/api/budgets/confirm?year=${YEAR}&month=6`),
      emptyRouteContext(),
    );
    expect(again.status).toBe(404);

    const june = await prisma.budget.findFirstOrThrow({
      where: { tenantId, accountId: food.id, period: { fiscalYear: YEAR, month: 6 } },
    });
    expect(june.amount.toNumber()).toBe(50_000); // 解除しても予算の値はそのまま
    const patch = await budgetPatch(
      makeReq("PATCH", `http://x/api/budgets/${june.id}`, { amount: 49_000 }),
      params(june.id),
    );
    expect(patch.status).toBe(200);
  });

  it("他テナントの科目を混ぜた確定は 404 で、確定も書き込みもしない", async () => {
    actingUser = editor;
    const other = await prisma.account.findFirst({ where: { tenantId: { not: tenantId } } });
    if (!other) return; // 他テナントの科目が無い DB ではこの検証を省く
    const res = await confirmPost(
      makeReq("POST", "http://x/api/budgets/confirm", {
        year: YEAR,
        month: 7,
        items: [
          { accountId: food.id, amount: 1 },
          { accountId: other.id, amount: 1 },
        ],
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(404);
    const confirmed = await prisma.budgetConfirmation.count({
      where: { tenantId, period: { fiscalYear: YEAR, month: 7 } },
    });
    expect(confirmed).toBe(0);
  });
});
