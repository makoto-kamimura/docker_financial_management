/**
 * 銀行明細の「カード代金の引き落とし」の結合テスト（実 DB 使用）
 *
 *   - 銀行の出金のチャージ先にクレジットカードを選ぶと、カード代金として科目が外れ、実績にも未割り当てにも入らない
 *   - 同じ口座・同じ摘要の未割り当ての出金にも付く（確定済みの月の明細は変えない）
 *   - 対の明細は持たない。入金はカード代金にできない
 *   - 前にカード代金にした摘要の明細は、取り込みと「まとめて自動処理」で自動でカード代金になる
 *
 * 実行: `npm run test:integration`
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
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { tenantDb } from "@/lib/server/tenant-db";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { insertExternalEntries } from "@/lib/ledger/ledger-entries";
import { POST as bankTxnPost } from "./bank-accounts/[id]/transactions/route";
import { PATCH as bankCharge } from "./bank-transactions/[id]/charge/route";
import { GET as unassignedGet } from "./ledger/unassigned/route";
import { POST as autoProcessPost } from "./ledger/auto-process/route";

const SUFFIX = `settle_${Date.now()}`;
const YEAR = 2033;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let expense: { id: number };
let bankId: number;
let otherBankId: number;
let creditCardId: number;
let otherCardId: number;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "カード代金テスト",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  expense = await prisma.account.create({
    data: { tenantId, code: `EXP_${SUFFIX}`, name: "食費", category: "EXPENSE" },
  });
  const [bank, otherBank, credit, otherCredit] = await Promise.all([
    prisma.bankAccount.create({ data: { tenantId, name: "生活費口座", bankName: "テスト銀行" } }),
    prisma.bankAccount.create({ data: { tenantId, name: "別の口座", bankName: "テスト銀行" } }),
    prisma.linkedAccount.create({
      data: { tenantId, name: "テストカード", type: "CREDIT_CARD", institution: "テスト" },
    }),
    prisma.linkedAccount.create({
      data: { tenantId, name: "別のカード", type: "CREDIT_CARD", institution: "テスト" },
    }),
  ]);
  bankId = bank.id;
  otherBankId = otherBank.id;
  creditCardId = credit.id;
  otherCardId = otherCredit.id;
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

async function postBankTxn(accountId: number, date: string, description: string, amount: number) {
  const res = await bankTxnPost(
    makeReq("POST", `http://x/api/bank-accounts/${accountId}/transactions`, {
      date,
      description,
      amount,
    }),
    params(accountId),
  );
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

const row = (id: number) => prisma.financialRecord.findUniqueOrThrow({ where: { id } });

const charge = (id: number, body: unknown) =>
  bankCharge(makeReq("PATCH", "http://x", body), params(id));

async function unassigned(month: number) {
  const res = await unassignedGet(
    makeReq("GET", `http://x/api/ledger/unassigned?year=${YEAR}&month=${month}`),
    emptyRouteContext(),
  );
  return ((await res.json()).data as { id: number }[]).map((e) => e.id);
}

async function confirmMonth(month: number) {
  const period = await prisma.period.findUniqueOrThrow({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: YEAR, month } },
  });
  await prisma.actualsConfirmation.create({
    data: { tenantId, periodId: period.id, confirmedById: actingUser.id },
  });
}

describe("カード代金の引き落とし", () => {
  it("クレジットカードを選ぶと科目が外れ、実績にも未割り当てにも入らない。同じ摘要の出金にも付く", async () => {
    // 2 月は確定済みにする（その月の明細は広げる先から外れる）
    const locked = await postBankTxn(bankId, `${YEAR}-02-27`, "カード代金 テスト", -70_000);
    await confirmMonth(2);
    const first = await postBankTxn(bankId, `${YEAR}-03-27`, "カード代金 テスト", -80_000);
    const second = await postBankTxn(bankId, `${YEAR}-04-27`, "カード代金  テスト", -90_000);
    const otherBank = await postBankTxn(otherBankId, `${YEAR}-04-27`, "カード代金 テスト", -5_000);
    const refund = await postBankTxn(bankId, `${YEAR}-04-28`, "カード代金 テスト", 1_000);
    await prisma.financialRecord.update({
      where: { id: first.id },
      data: { accountId: expense.id, amount: 80_000 },
    });
    expect(await unassigned(4)).toEqual(
      expect.arrayContaining([second.id, otherBank.id, refund.id]),
    );

    const res = await charge(first.id, { chargeToAccountId: creditCardId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ chargeToAccountId: creditCardId, categoryAccountId: null });
    expect(body.data.chargeToAccount).toMatchObject({ id: creditCardId, type: "CREDIT_CARD" });
    expect(body.updatedSiblingCount).toBe(1);

    const f = await row(first.id);
    expect([f.accountId, Number(f.amount), f.chargeGroupId]).toEqual([null, 0, null]);
    // 同じ口座・同じ摘要（空白の違いは同じとみなす）の出金にだけ付く
    expect((await row(second.id)).chargeToCardId).toBe(creditCardId);
    expect((await row(otherBank.id)).chargeToCardId).toBeNull();
    expect((await row(refund.id)).chargeToCardId).toBeNull();
    expect((await row(locked.id)).chargeToCardId).toBeNull();

    const left = await unassigned(4);
    expect(left).not.toContain(second.id);
    expect(left).toEqual(expect.arrayContaining([otherBank.id, refund.id]));

    // 解除すると、また科目を付けられる明細に戻る
    const undo = await charge(second.id, { chargeToAccountId: null });
    expect(undo.status).toBe(200);
    expect(await unassigned(4)).toContain(second.id);
  });

  it("対の明細は指定できず、入金はカード代金にできない", async () => {
    const out = await postBankTxn(bankId, `${YEAR}-05-27`, "別の引き落とし", -1_000);
    const inn = await postBankTxn(bankId, `${YEAR}-05-28`, "入金", 1_000);
    expect(
      (await charge(out.id, { chargeToAccountId: creditCardId, pairTxnId: inn.id })).status,
    ).toBe(400);
    expect((await charge(inn.id, { chargeToAccountId: creditCardId })).status).toBe(400);
    expect((await row(out.id)).chargeToCardId).toBeNull();
  });

  it("前にカード代金にした摘要の明細は、取り込みで自動でカード代金になり、科目が付かない", async () => {
    // 学習ルールが同じ摘要に科目を付けるものでも、カード代金を先に見る
    await prisma.txnCategoryRule.create({
      data: { tenantId, keyword: "カード代金", categoryAccountId: expense.id, priority: 100 },
    });
    const result = await insertExternalEntries(
      tenantDb(tenantId),
      tenantId,
      { kind: "BANK", accountId: bankId },
      [
        {
          externalId: `${SUFFIX}-1`,
          date: `${YEAR}-06-27`,
          description: "カード代金 テスト",
          amount: -60_000,
        },
        {
          externalId: `${SUFFIX}-2`,
          date: `${YEAR}-06-28`,
          description: "スーパー",
          amount: -2_000,
        },
      ],
      "CSV",
    );
    expect(result.inserted).toBe(2);
    const imported = await prisma.financialRecord.findFirstOrThrow({
      where: { tenantId, externalId: `${SUFFIX}-1` },
    });
    expect([imported.chargeToCardId, imported.accountId, Number(imported.amount)]).toEqual([
      creditCardId,
      null,
      0,
    ]);
    expect(
      (
        await prisma.financialRecord.findFirstOrThrow({
          where: { tenantId, externalId: `${SUFFIX}-2` },
        })
      ).chargeToCardId,
    ).toBeNull();
  });

  it("まとめて自動処理でも、前にカード代金にした摘要の未割り当ての出金をカード代金にする", async () => {
    const pending = await postBankTxn(bankId, `${YEAR}-07-27`, "カード代金 テスト", -50_000);
    await prisma.financialRecord.update({
      where: { id: pending.id },
      data: { accountId: null, amount: 0 },
    });
    // 同じ摘要が別々のカードに分かれている口座では、どちらとも決めない
    const a = await postBankTxn(otherBankId, `${YEAR}-07-01`, "まとめて引き落とし", -100);
    const b = await postBankTxn(otherBankId, `${YEAR}-07-02`, "まとめて引き落とし", -200);
    await prisma.financialRecord.update({
      where: { id: a.id },
      data: { chargeToCardId: creditCardId },
    });
    await prisma.financialRecord.update({
      where: { id: b.id },
      data: { chargeToCardId: otherCardId },
    });
    const ambiguous = await postBankTxn(otherBankId, `${YEAR}-07-03`, "まとめて引き落とし", -300);

    const res = await autoProcessPost(
      makeReq("POST", "http://x/api/ledger/auto-process"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const result = (await res.json()).data;
    expect(result.settled).toBeGreaterThanOrEqual(1);
    expect((await row(pending.id)).chargeToCardId).toBe(creditCardId);
    expect((await row(ambiguous.id)).chargeToCardId).toBeNull();
  });
});
