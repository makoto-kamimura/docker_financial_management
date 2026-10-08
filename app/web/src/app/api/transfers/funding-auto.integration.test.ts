/**
 * 毎月の入出金（資金移動ルール）と借入の引き落とし 結合テスト（実 DB 使用）
 *
 * - 引き落とし口座と日を入れた借入は、同じ口座・日・金額の資金移動ルールがあれば
 *   「ルールで引き落とし済み」とする（残高の見込みで二重に数えない）
 * - 毎月の入出金の一覧（GET /api/transfers/flow）に資金移動ルールが並ぶ
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
import { createTestEntry } from "@/lib/test-entries";
import { emptyRouteContext } from "@/lib/api-handler";
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

async function suggestions() {
  const res = await suggestionsGet(
    makeReq("GET", "http://x/api/transfers/suggestions"),
    emptyRouteContext(),
  );
  return (await res.json()).data as { label: string; signature: string; accountId: number }[];
}

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "bank_accounts",
    "financial_records",
    "periods",
    "loans",
    "transfers",
  ]) {
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
  for (const i of [1, 2, 3, 4]) {
    await createTestEntry(
      tenantId,
      { kind: "BANK", accountId: bankId },
      {
        date: new Date(now.getFullYear(), now.getMonth() - i, 27),
        description: `家賃 ${i}`,
        flow: -80_000,
      },
    );
  }
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
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("借入の引き落としと資金移動ルール", () => {
  const loans = async () =>
    (await (await loansGet(makeReq("GET", "http://x/api/loans"), emptyRouteContext())).json())
      .data as { debitCoveredByRule: boolean }[];

  it("同じ口座・日・金額の資金移動ルールが無ければ、借入の引き落としはルールで賄われていない", async () => {
    expect((await loans())[0].debitCoveredByRule).toBe(false);
  });

  it("同じ口座・日・金額の資金移動ルールがあれば、借入はルールで引き落とし済みになり、一覧に並ぶ", async () => {
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
    expect((await loans())[0].debitCoveredByRule).toBe(true);
    const flow = await (
      await flowGet(makeReq("GET", "http://x/api/transfers/flow"), emptyRouteContext())
    ).json();
    expect(flow.transfers).toEqual([
      expect.objectContaining({
        label: "ローン引き落とし",
        amount: 50_000,
        channelLabel: "銀行引き落とし",
        fromAccountId: bankId,
      }),
    ]);
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
