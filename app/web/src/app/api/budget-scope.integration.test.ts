/**
 * 予算の範囲（家庭・事業）の結合テスト（実 DB 使用）
 *
 *   - 予算・カレンダーの内訳・配分ルール・科目の振り分けは、家庭（scope 省略）と事業（scope=business）で別々に持つ
 *   - 予算の確定は範囲ごと。実績の確定は共通で、どちらかの予算が確定していればよい
 *   - 予実差・KPI の予算は、範囲ごとの予算と範囲ごとの実績で出す
 *   - 資金繰りの家庭の見込みは、事業の予算では変わらない
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
import {
  DEFAULT_ALLOCATION_RULES,
  DEFAULT_BUSINESS_ALLOCATION_RULES,
  seedDefaultAllocationRulesForTenant,
} from "@/lib/budget/default-allocation-rules";
import { GET as budgetsGet, POST as budgetsPost } from "./budgets/route";
import { POST as confirmPost, DELETE as confirmDelete } from "./budgets/confirm/route";
import { POST as actualsConfirmPost } from "./actuals/confirm/route";
import { GET as varianceGet } from "./budgets/variance/route";
import { GET as itemsGet, POST as itemsPost } from "./budget-items/route";
import { GET as historyGet } from "./budgets/history/route";
import { GET as rulesGet } from "./allocation-rules/route";
import { PUT as assignPut } from "./allocation-rules/assignments/route";
import { GET as kpiGet } from "./kpi/route";
import { GET as cashOutlookGet } from "./bank-accounts/cash-outlook/route";

const SUFFIX = `bscope_${Date.now()}`;
const YEAR = 2036;
const BIZ = "&scope=business";

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
type Handler = typeof budgetsGet;
const call = (handler: Handler, url: string, method = "GET", body?: unknown) =>
  handler(makeReq(`http://x${url}`, method, body), emptyRouteContext());
const get = async (handler: Handler, url: string) => (await call(handler, url)).json();

let tenantId: number;
let expense: { id: number; code: string; category: "EXPENSE" };

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "financial_records",
    "bank_accounts",
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
      name: "予算",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  const code = `E_${SUFFIX}`;
  expense = {
    id: (
      await prisma.account.create({
        data: { tenantId, code, name: "通信費", category: "EXPENSE" },
      })
    ).id,
    code,
    category: "EXPENSE",
  };
  await prisma.bankAccount.create({
    data: { tenantId, name: "事業口座", bankName: "銀行", businessUse: true },
  });
  // 3 月の実績: 現金の通信費 4,000 を事業 50%（家庭は 4,000、事業は 2,000）
  await createTestEntry(
    tenantId,
    { kind: "CASH" },
    {
      date: new Date(YEAR, 2, 10),
      description: "携帯電話",
      flow: -4000,
      category: expense,
      business: { businessUse: true, businessRatio: 50 },
    },
  );
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.budgetItem.deleteMany({ where });
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.allocationAccountAssignment.deleteMany({ where });
  await prisma.allocationRule.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const putBudget = (month: number, amount: number, scope = "", year = YEAR) =>
  call(budgetsPost, `/api/budgets?${scope}`, "POST", {
    accountCode: expense.code,
    fiscalYear: year,
    month,
    amount,
  });

describe("予算は家庭と事業で別々", () => {
  it("予算の一覧と変更履歴は範囲ごと", async () => {
    expect((await putBudget(3, 5000)).status).toBe(201);
    expect((await putBudget(3, 1500, BIZ)).status).toBe(201);
    const amounts = (res: { data: { amount: string }[] }) => res.data.map((b) => Number(b.amount));
    expect(amounts(await get(budgetsGet, `/api/budgets?year=${YEAR}`))).toEqual([5000]);
    expect(amounts(await get(budgetsGet, `/api/budgets?year=${YEAR}${BIZ}`))).toEqual([1500]);

    const historyAmounts = async (scope: string) =>
      (await get(historyGet, `/api/budgets/history?year=${YEAR}${scope}`)).data.map(
        (h: { amount: number }) => h.amount,
      );
    expect(await historyAmounts("")).toEqual([5000]);
    expect(await historyAmounts(BIZ)).toEqual([1500]);
  });

  it("カレンダーの内訳は、その範囲の予算にだけ足す", async () => {
    const res = await call(itemsPost, `/api/budget-items?scope=business`, "POST", {
      date: `${YEAR}-04-05`,
      accountCode: expense.code,
      description: "回線",
      amount: 800,
    });
    expect(res.status).toBe(201);
    const items = async (scope: string) =>
      (await get(itemsGet, `/api/budget-items?year=${YEAR}&month=4${scope}`)).data.length;
    expect(await items(BIZ)).toBe(1);
    expect(await items("")).toBe(0);
    const april = await prisma.budget.findMany({
      where: { tenantId, period: { month: 4 } },
      select: { scope: true, amount: true },
    });
    expect(april.map((b) => [b.scope, Number(b.amount)])).toEqual([["BUSINESS", 800]]);
  });

  it("予実差: 範囲ごとの予算と範囲ごとの実績を比べる", async () => {
    const row = async (scope: string) => {
      const res = await get(varianceGet, `/api/budgets/variance?year=${YEAR}&month=3${scope}`);
      return res.data.rows.find((r: { accountId: number }) => r.accountId === expense.id);
    };
    expect(await row("")).toMatchObject({ budget: 5000, actual: 4000 });
    expect(await row(BIZ)).toMatchObject({ budget: 1500, actual: 2000 });
  });

  it("KPI の予算も範囲ごと", async () => {
    const home = await get(kpiGet, `/api/kpi?period=${YEAR}-03`);
    const biz = await get(kpiGet, `/api/kpi?period=${YEAR}-03${BIZ}`);
    expect(home.budget).toMatchObject({ expense: 5000 });
    expect(biz.budget).toMatchObject({ expense: 1500 });
  });
});

describe("予算の確定は範囲ごと、実績の確定は共通", () => {
  const confirm = (month: number, scope = "") =>
    call(confirmPost, `/api/budgets/confirm?${scope}`, "POST", { year: YEAR, month });
  const status = async (month: number, scope = "") =>
    (await get(varianceGet, `/api/budgets/variance?year=${YEAR}&month=${month}${scope}`)).data;
  const confirmActuals = async (month: number) => {
    const res = await call(actualsConfirmPost, "/api/actuals/confirm", "POST", {
      year: YEAR,
      month,
    });
    return { status: res.status, error: (await res.json()).error as string };
  };

  it("予算が未確定なら、実績は確定できない", async () => {
    const res = await confirmActuals(3);
    expect(res.status).toBe(409);
    expect(res.error).toContain("予算が確定していません");
  });

  it("事業の予算を確定しても、家庭の予算は未確定のまま編集できる", async () => {
    expect((await confirm(3, BIZ)).status).toBe(201);
    expect((await confirm(3, BIZ)).status).toBe(409);
    expect((await status(3, BIZ)).confirmedAt).not.toBeNull();
    expect((await status(3)).confirmedAt).toBeNull();

    expect((await putBudget(3, 1600, BIZ)).status).toBe(409);
    expect((await putBudget(3, 5200)).status).toBe(201);
  });

  it("どちらかの予算が確定していれば、実績の確定は予算の確認を通る", async () => {
    // 明細の口座がそろっていないので別の理由で止まるが、予算の確認は通っている
    const res = await confirmActuals(3);
    expect(res.status).toBe(409);
    expect(res.error).not.toContain("予算が確定していません");
  });

  it("家庭の予算も別に確定でき、確定の解除も範囲ごと", async () => {
    expect((await confirm(3)).status).toBe(201);
    const del = await call(
      confirmDelete,
      `/api/budgets/confirm?year=${YEAR}&month=3${BIZ}`,
      "DELETE",
    );
    expect(del.status).toBe(204);
    expect((await status(3, BIZ)).confirmedAt).toBeNull();
    expect((await status(3)).confirmedAt).not.toBeNull();
  });
});

describe("配分ルール", () => {
  it("新しいテナントには家庭と事業の両方の初期値が入り、範囲ごとに読める", async () => {
    const created = await seedDefaultAllocationRulesForTenant(prisma, tenantId);
    expect(created).toBe(
      DEFAULT_ALLOCATION_RULES.length + DEFAULT_BUSINESS_ALLOCATION_RULES.length,
    );
    const keys = async (scope: string) =>
      (await get(rulesGet, `/api/allocation-rules?${scope}`)).data.map(
        (r: { key: string }) => r.key,
      );
    expect(await keys("")).toEqual(DEFAULT_ALLOCATION_RULES.map((r) => r.key));
    expect(await keys(BIZ)).toEqual(DEFAULT_BUSINESS_ALLOCATION_RULES.map((r) => r.key));
  });

  it("科目の振り分けは範囲ごと", async () => {
    const ruleOf = async (scope: string) => {
      const res = await get(rulesGet, `/api/allocation-rules?${scope}`);
      return res.data.find((r: { accounts: { id: number }[] }) =>
        r.accounts.some((a) => a.id === expense.id),
      )?.key;
    };
    expect(await ruleOf("")).toBe("communication");
    expect(await ruleOf(BIZ)).toBe("communication");

    const bizRules = await prisma.allocationRule.findMany({
      where: { tenantId, scope: "BUSINESS", key: "fees" },
      select: { id: true },
    });
    const res = await call(assignPut, `/api/allocation-rules/assignments?${BIZ}`, "PUT", {
      accountId: expense.id,
      ruleId: bizRules[0].id,
    });
    expect(res.status).toBe(200);
    expect(await ruleOf(BIZ)).toBe("fees");
    expect(await ruleOf("")).toBe("communication");
  });
});

describe("資金繰り", () => {
  it("家庭の見込みは事業の予算で変わらず、事業の見込みは事業の予算で変わる", async () => {
    const now = new Date();
    const next = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const outlook = async (scope: string) =>
      (await get(cashOutlookGet, `/api/bank-accounts/cash-outlook?${scope}`)).total;
    const homeBefore = await outlook("");
    const bizBefore = await outlook(BIZ);
    expect((await putBudget(next, 30_000, BIZ, nextYear)).status).toBe(201);
    expect(await outlook("")).toEqual(homeBefore);
    expect(await outlook(BIZ)).not.toEqual(bizBefore);
  });
});
