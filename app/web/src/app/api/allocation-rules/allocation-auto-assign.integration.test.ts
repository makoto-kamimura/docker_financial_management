/**
 * 予算配分の自動振り分け 結合テスト（実 DB 使用）
 *
 * 科目名のキーワードと受け皿の区分で、追加した科目も自動で配分ルールに入ること、
 * 手で移した割り当てが優先されること、適正金額がメンバー科目へ按分されること、
 * 予算への反映が予算未設定の科目だけに入ることを、実際のルートハンドラ経由で確かめる。
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/prisma";
import { emptyRouteContext } from "@/lib/api-handler";
import { seedDefaultAllocationRulesForTenant } from "@/lib/default-allocation-rules";
import { GET as rulesGet } from "./route";
import { PUT as assignPut } from "./assignments/route";
import { GET as guideGet } from "../budgets/allocation-guide/route";
import { GET as suggestGet } from "../budgets/allocation-suggest/route";
import { POST as applyPost } from "../budgets/allocation-apply/route";

const SUFFIX = `aa_${Date.now()}`;
const YEAR = 2095; // 他のテストと衝突しない専用の年度

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

type RuleView = { id: number; key: string; accounts: { id: number; source: string }[] };

let tenantId: number;
const ids: Record<string, number> = {};

async function rules(): Promise<{ data: RuleView[]; unassigned: { id: number }[] }> {
  const res = await rulesGet(makeReq("GET", "http://x/api/allocation-rules"), emptyRouteContext());
  expect(res.status).toBe(200);
  return res.json();
}
const ruleOf = (view: RuleView[], accountId: number) =>
  view.find((r) => r.accounts.some((a) => a.id === accountId))?.key ?? null;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "allocation_rules", "audit_logs"]) {
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
  await prisma.$transaction((tx) => seedDefaultAllocationRulesForTenant(tx, tenantId));

  for (const [key, name, category] of [
    ["salary", "給与", "REVENUE"],
    ["power", "電気代", "EXPENSE"],
    ["gas", "ガス代", "EXPENSE"],
    ["tax", "住民税", "EXPENSE"],
    ["hobby", "推し活費", "COGS"],
  ] as const) {
    const a = await prisma.account.create({
      data: { tenantId, code: `${key}_${SUFFIX}`, name, category },
    });
    ids[key] = a.id;
  }

  // 前の 3 か月（2〜4 月）の実績: 電気 3 : ガス 1。5 月の収入 300,000
  for (const month of [2, 3, 4, 5]) {
    const period = await prisma.period.create({
      data: { tenantId, fiscalYear: YEAR, month, quarter: Math.ceil(month / 3) },
    });
    ids[`p${month}`] = period.id;
    const rows =
      month === 5
        ? [{ accountId: ids.salary, amount: 300_000 }]
        : [
            { accountId: ids.power, amount: 9_000 },
            { accountId: ids.gas, amount: 3_000 },
          ];
    await prisma.financialRecord.createMany({
      data: rows.map((r) => ({ tenantId, periodId: period.id, ...r })),
    });
  }
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.allocationAccountAssignment.deleteMany({ where });
  await prisma.allocationRule.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("予算配分の自動振り分け", () => {
  it("キーワードと受け皿で振り分け、収入は対象外", async () => {
    const { data } = await rules();
    expect(ruleOf(data, ids.power)).toBe("utilities");
    expect(ruleOf(data, ids.gas)).toBe("utilities");
    expect(ruleOf(data, ids.tax)).toBe("other_fixed");
    expect(ruleOf(data, ids.hobby)).toBe("other_living");
    expect(ruleOf(data, ids.salary)).toBeNull();
  });

  it("追加した科目も、保存せずにすぐ配分に入る", async () => {
    const a = await prisma.account.create({
      data: { tenantId, code: `pet_${SUFFIX}`, name: "ペット保険", category: "EXPENSE" },
    });
    ids.pet = a.id;
    expect(ruleOf((await rules()).data, a.id)).toBe("insurance");
  });

  it("適正金額: ルールの推奨額を、前の 3 か月の実績の比率でメンバー科目へ按分する", async () => {
    const res = await guideGet(
      makeReq("GET", `http://x/api/budgets/allocation-guide?year=${YEAR}`),
      emptyRouteContext(),
    );
    const { data } = await res.json();
    const may = (accountId: number) =>
      data.find(
        (r: { accountId: number; month: number }) => r.accountId === accountId && r.month === 5,
      )?.amount;
    // 光熱費の推奨 = 300,000 × 6.5% = 19,500 → 電気 3 : ガス 1
    expect(may(ids.power)).toBe(14_625);
    expect(may(ids.gas)).toBe(4_875);
  });

  it("手で移すと優先され、自動に戻すと元に戻る", async () => {
    const { data } = await rules();
    const food = data.find((r) => r.key === "food")!.id;
    const moved = await assignPut(
      makeReq("PUT", "http://x/api/allocation-rules/assignments", {
        accountId: ids.gas,
        ruleId: food,
      }),
      emptyRouteContext(),
    );
    expect(moved.status).toBe(200);
    const after = (await moved.json()).data as RuleView[];
    expect(ruleOf(after, ids.gas)).toBe("food");
    expect(
      after.find((r) => r.key === "food")!.accounts.find((a) => a.id === ids.gas)!.source,
    ).toBe("manual");

    // 配分から外す
    await assignPut(
      makeReq("PUT", "http://x/api/allocation-rules/assignments", {
        accountId: ids.gas,
        ruleId: null,
      }),
      emptyRouteContext(),
    );
    const excluded = await rules();
    expect(ruleOf(excluded.data, ids.gas)).toBeNull();
    expect(excluded.unassigned.map((a) => a.id)).toContain(ids.gas);

    // 自動に戻す
    await assignPut(
      makeReq("PUT", "http://x/api/allocation-rules/assignments", {
        accountId: ids.gas,
        ruleId: "auto",
      }),
      emptyRouteContext(),
    );
    expect(ruleOf((await rules()).data, ids.gas)).toBe("utilities");

    // 収入の科目は配分に入れられない
    const bad = await assignPut(
      makeReq("PUT", "http://x/api/allocation-rules/assignments", {
        accountId: ids.salary,
        ruleId: food,
      }),
      emptyRouteContext(),
    );
    expect(bad.status).toBe(400);
  });

  it("配分提案は科目ごとの按分と、入っている予算を返す", async () => {
    await prisma.budget.create({
      data: { tenantId, accountId: ids.power, periodId: ids.p5, amount: 10_000 },
    });
    const res = await suggestGet(
      makeReq(
        "GET",
        `http://x/api/budgets/allocation-suggest?year=${YEAR}&month=5&basis=manual&amount=300000`,
      ),
      emptyRouteContext(),
    );
    const { data } = await res.json();
    const utilities = data.items.find((i: { rule: { key: string } }) => i.rule.key === "utilities");
    expect(utilities.recommended).toBe(19_500);
    expect(
      utilities.accounts.map((a: { id: number; recommended: number; budget: number | null }) => [
        a.id,
        a.recommended,
        a.budget,
      ]),
    ).toEqual([
      [ids.power, 14_625, 10_000],
      [ids.gas, 4_875, null],
    ]);
  });

  it("予算への反映は、予算が入っている科目を書き換えない", async () => {
    const res = await applyPost(
      makeReq("POST", "http://x/api/budgets/allocation-apply", {
        year: YEAR,
        items: [
          { accountId: ids.power, month: 5, amount: 99_999 },
          { accountId: ids.gas, month: 5, amount: 9_500 },
        ],
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ applied: 1, skipped: 1 });
    const budgets = await prisma.budget.findMany({
      where: { tenantId, periodId: ids.p5 },
      select: { accountId: true, amount: true },
    });
    const byId = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
    expect(byId.get(ids.power)).toBe(10_000);
    expect(byId.get(ids.gas)).toBe(9_500);
  });
});
