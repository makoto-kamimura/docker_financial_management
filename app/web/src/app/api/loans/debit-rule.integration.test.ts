/**
 * 借入の引き落としと資金移動ルール 結合テスト（実 DB 使用）
 *
 * - 引き落とし口座と日を入れた借入は、同じ口座・日・金額の資金移動ルールがあれば
 *   「ルールで引き落とし済み」とする（残高の見込みで二重に数えない）
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
import { GET as loansGet } from "./route";

const SUFFIX = `ldr_${Date.now()}`;

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

beforeAll(async () => {
  for (const t of ["tenants", "users", "bank_accounts", "loans", "transfers"]) {
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
  await prisma.transfer.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
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

  it("同じ口座・日・金額の資金移動ルールがあれば、借入はルールで引き落とし済みになる", async () => {
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
  });
});
