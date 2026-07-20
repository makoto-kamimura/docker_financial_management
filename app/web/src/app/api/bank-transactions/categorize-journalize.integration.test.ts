/**
 * D-5d-1 結合テスト（実 DB 使用）
 *
 * 目的: PATCH /api/bank-transactions/[id]/categorize の post:true が、
 *       BankAccount.accountId が設定されている口座に対しては複式仕訳
 *       （choke-point 経由の FinancialRecord 同期）を生成し、未設定の口座では
 *       従来どおりの単側直接書き込みへフォールバックすることを検証する。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/prisma";
import { PATCH as categorizePatch } from "./[id]/categorize/route";

const SUFFIX = `d5d1_${Date.now()}`;

function makeReq(body: unknown) {
  return {
    method: "PATCH",
    nextUrl: new URL("http://x"),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let userId: number;
let bankAssetAccountId: number; // 口座に紐付く ASSET 科目
let expenseAccountId: number;
let revenueAccountId: number;
let linkedBankAccountId: number; // accountId 設定済み
let unlinkedBankAccountId: number; // accountId 未設定

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `D5D1_${SUFFIX}` } });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `d5d1_${SUFFIX}@example.com`,
      name: "D-5d-1 Test User",
      passwordHash: "x",
      role: "admin",
    },
  });
  userId = user.id;

  const [bankAsset, expense, revenue] = await Promise.all([
    prisma.account.create({
      data: { tenantId, code: `D5D1-BANK_${SUFFIX}`, name: "普通預金", category: "ASSET" },
    }),
    prisma.account.create({
      data: { tenantId, code: `D5D1-EXP_${SUFFIX}`, name: "通信費", category: "EXPENSE" },
    }),
    prisma.account.create({
      data: { tenantId, code: `D5D1-REV_${SUFFIX}`, name: "売上高", category: "REVENUE" },
    }),
  ]);
  bankAssetAccountId = bankAsset.id;
  expenseAccountId = expense.id;
  revenueAccountId = revenue.id;

  const [linkedBank, unlinkedBank] = await Promise.all([
    prisma.bankAccount.create({
      data: {
        tenantId,
        name: "紐付け済み口座",
        bankName: "テスト銀行",
        accountId: bankAssetAccountId,
      },
    }),
    prisma.bankAccount.create({
      data: { tenantId, name: "未紐付け口座", bankName: "テスト銀行" },
    }),
  ]);
  linkedBankAccountId = linkedBank.id;
  unlinkedBankAccountId = unlinkedBank.id;

  actingUser = { id: userId, tenantId, role: "admin", email: user.email, name: user.name };
});

afterAll(async () => {
  if (!tenantId) return;
  await prisma.financialRecordHistory.deleteMany({
    where: { record: { tenantId } },
  });
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.bankTransaction.deleteMany({ where: { account: { tenantId } } });
  await prisma.bankAccount.deleteMany({ where: { tenantId } });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("D-5d-1: 銀行口座に勘定科目が紐付いている場合は複式仕訳化する", () => {
  it("支出（負の金額）: Dr 分類科目(EXPENSE) / Cr 口座科目(ASSET) の仕訳を作り、EXPENSE 側だけが FinancialRecord に正の符号で同期される", async () => {
    const txn = await prisma.bankTransaction.create({
      data: {
        accountId: linkedBankAccountId,
        date: new Date("2026-07-01"),
        description: "D-5d-1 支出検証",
        amount: -3000,
      },
    });

    const res = await categorizePatch(
      makeReq({ categoryAccountId: expenseAccountId, post: true }),
      params(txn.id),
    );
    expect(res.status).toBe(200);

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: "D-5d-1 支出検証" },
      include: { details: { orderBy: { side: "asc" } } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.details).toHaveLength(2);
    expect(entry!.details.map((d) => [d.side, d.accountId, Number(d.amount)])).toEqual(
      expect.arrayContaining([
        ["debit", expenseAccountId, 3000],
        ["credit", bankAssetAccountId, 3000],
      ]),
    );

    const records = await prisma.financialRecord.findMany({
      where: { tenantId, journalEntryId: entry!.id },
    });
    expect(records).toHaveLength(1);
    expect(records[0].accountId).toBe(expenseAccountId);
    expect(Number(records[0].amount)).toBe(3000);

    const updated = await prisma.bankTransaction.findUnique({ where: { id: txn.id } });
    expect(updated?.postedRecordId).toBe(records[0].id);
  });

  it("収入（正の金額）: Dr 口座科目(ASSET) / Cr 分類科目(REVENUE) の仕訳を作り、REVENUE 側だけが正の符号で同期される", async () => {
    const txn = await prisma.bankTransaction.create({
      data: {
        accountId: linkedBankAccountId,
        date: new Date("2026-07-02"),
        description: "D-5d-1 収入検証",
        amount: 5000,
      },
    });

    const res = await categorizePatch(
      makeReq({ categoryAccountId: revenueAccountId, post: true }),
      params(txn.id),
    );
    expect(res.status).toBe(200);

    const records = await prisma.financialRecord.findMany({
      where: { tenantId, account: { id: revenueAccountId } },
      include: { journalEntry: true },
    });
    const record = records.find((r) => r.journalEntry?.description === "D-5d-1 収入検証");
    expect(record).toBeDefined();
    expect(Number(record!.amount)).toBe(5000);
  });

  it("口座に勘定科目が未紐付けの場合は仕訳を作らず、従来どおり単側直接書き込みにフォールバックする", async () => {
    const txn = await prisma.bankTransaction.create({
      data: {
        accountId: unlinkedBankAccountId,
        date: new Date("2026-07-03"),
        description: "D-5d-1 未紐付け検証",
        amount: -1000,
      },
    });

    const res = await categorizePatch(
      makeReq({ categoryAccountId: expenseAccountId, post: true }),
      params(txn.id),
    );
    expect(res.status).toBe(200);

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: "D-5d-1 未紐付け検証" },
    });
    expect(entry).toBeNull();

    const updated = await prisma.bankTransaction.findUnique({ where: { id: txn.id } });
    const record = await prisma.financialRecord.findUnique({
      where: { id: updated!.postedRecordId! },
    });
    expect(record?.journalEntryId).toBeNull();
    expect(Number(record?.amount)).toBe(1000);
  });
});
