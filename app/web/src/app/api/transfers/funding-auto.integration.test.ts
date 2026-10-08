/**
 * 資金繰りの自動化 結合テスト（実 DB 使用）
 *
 * - 引き落とし口座と日を入れた借入の返済が、資金繰り・資金フロー図に自動で入る
 * - 同じ口座・日・金額の資金移動ルールがあれば、借入からは入れない（二重に数えない）
 * - 明細から「毎月の入出金」の候補が出て、非表示にすると出なくなる
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
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
import { GET as fundingGet } from "./funding/route";
import { GET as flowGet } from "./flow/route";
import { GET as suggestionsGet } from "./suggestions/route";
import { POST as dismissPost } from "./suggestions/dismiss/route";
import { GET as loansGet } from "../loans/route";

const SUFFIX = `fa_${Date.now()}`;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

let tenantId: number;
let bankId: number;
const now = new Date();

async function fundingEvents() {
  const res = await fundingGet(
    makeReq(
      "GET",
      `http://x/api/transfers/funding?year=${now.getFullYear()}&month=${now.getMonth() + 1}&months=1`,
    ),
    emptyRouteContext(),
  );
  const json = await res.json();
  return json.plans.find((p: { accountId: number }) => p.accountId === bankId).events as {
    label: string;
    amount: number;
  }[];
}
async function suggestions() {
  const res = await suggestionsGet(
    makeReq("GET", "http://x/api/transfers/suggestions"),
    emptyRouteContext(),
  );
  return (await res.json()).data as { label: string; signature: string; accountId: number }[];
}

beforeAll(async () => {
  for (const t of ["tenants", "users", "bank_accounts", "ledger_entries", "loans", "transfers"]) {
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
  // 直近 4 か月、毎月 27 日に家賃 8 万円の引き落とし（今月は除く）
  await prisma.ledgerEntry.createMany({
    data: [1, 2, 3, 4].map((i) => ({
      tenantId,
      kind: "BANK" as const,
      bankAccountId: bankId,
      date: new Date(now.getFullYear(), now.getMonth() - i, 27),
      description: `家賃 ${i}`,
      amount: -80_000,
    })),
  });
  await prisma.loan.create({
    data: {
      tenantId,
      lenderName: "住宅ローン",
      amount: 12_000_000,
      interestRate: 0,
      borrowedOn: new Date(Date.UTC(now.getFullYear() - 1, 0, 1)),
      repaymentDate: new Date(Date.UTC(now.getFullYear() + 5, 0, 1)),
      remainingAmount: 12_000_000,
      loanType: "housing",
      monthlyPayment: 50_000,
      debitBankAccountId: bankId,
      debitDay: 27,
    },
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.recurringSuggestionDismissal.deleteMany({ where });
  await prisma.transfer.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
  await prisma.ledgerEntry.deleteMany({ where: { tenantId } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("借入の返済を資金繰りに自動で入れる", () => {
  it("引き落とし口座と日を入れた借入の返済が、資金繰りと資金フロー図に入る", async () => {
    const events = await fundingEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ label: "借入返済: 住宅ローン", amount: -50_000 }),
    );
    const flow = await (
      await flowGet(makeReq("GET", "http://x/api/transfers/flow"), emptyRouteContext())
    ).json();
    expect(flow.graph.links.length).toBeGreaterThan(0);
  });

  it("同じ口座・日・金額の資金移動ルールがあれば、借入からは入れない", async () => {
    await prisma.transfer.create({
      data: {
        tenantId,
        fromAccountId: bankId,
        amount: 50_000,
        day: 27,
        channel: "AUTO_DEBIT",
        label: "ローン引き落とし",
      },
    });
    const events = await fundingEvents();
    expect(events.filter((e) => e.amount === -50_000).map((e) => e.label)).toEqual([
      "ローン引き落とし",
    ]);
    const loans = (
      await (await loansGet(makeReq("GET", "http://x/api/loans"), emptyRouteContext())).json()
    ).data;
    expect(loans[0].debitCoveredByRule).toBe(true);
  });
});

describe("明細から毎月の入出金を提案する", () => {
  it("毎月の家賃が候補に出て、非表示にすると出なくなる", async () => {
    const before = await suggestions();
    const rent = before.find((s) => s.label.startsWith("家賃"));
    expect(rent).toBeDefined();

    const res = await dismissPost(
      makeReq("POST", "http://x/api/transfers/suggestions/dismiss", {
        bankAccountId: rent!.accountId,
        signature: rent!.signature,
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    expect((await suggestions()).find((s) => s.label.startsWith("家賃"))).toBeUndefined();
  });
});
