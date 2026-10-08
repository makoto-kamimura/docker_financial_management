/**
 * 明細の表（ledger_entries）への統合の結合テスト（実 DB 使用）
 *
 * 銀行明細とカード明細を 1 つの表にまとめても、API の応答の形と符号、
 * 転記・チャージ・振替の動きが以前（bank_transactions / card_transactions）と同じことを確かめる。
 *   - 表の金額は +入金 / −出金。カードの API は以前どおり +利用 / −返金で受け取り・返す
 *   - カードの転記は、カードの科目（LIABILITY）を貸方にした仕訳になる
 *
 * 実行: `npm run test:integration`
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
import { emptyRouteContext } from "@/lib/api-handler";
import { GET as cardTxnGet, POST as cardTxnPost } from "./linked-accounts/[id]/transactions/route";
import {
  DELETE as bankTxnDelete,
  POST as bankTxnPost,
} from "./bank-accounts/[id]/transactions/route";
import { PATCH as cardCategorize } from "./card-transactions/[id]/categorize/route";
import { PATCH as bankCategorize } from "./bank-transactions/[id]/categorize/route";
import { PATCH as cardTransfer } from "./card-transactions/[id]/transfer/route";
import { PATCH as bankCharge } from "./bank-transactions/[id]/charge/route";
import { POST as transferLink } from "./bank-transfers/link/route";

const SUFFIX = `ledger_${Date.now()}`;

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
let expenseId: number;
let cardLiabilityId: number;
let bankId: number;
let creditCardId: number;
let eMoneyId: number;

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('ledger_entries', 'id'), COALESCE((SELECT MAX(id) FROM ledger_entries), 1))`,
  );
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "明細テスト",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  const [expense, liability] = await Promise.all([
    prisma.account.create({
      data: { tenantId, code: `EXP_${SUFFIX}`, name: "食費", category: "EXPENSE" },
    }),
    prisma.account.create({
      data: { tenantId, code: `LIA_${SUFFIX}`, name: "未払金（カード）", category: "LIABILITY" },
    }),
  ]);
  expenseId = expense.id;
  cardLiabilityId = liability.id;

  const [bank, credit, eMoney] = await Promise.all([
    prisma.bankAccount.create({ data: { tenantId, name: "給与口座", bankName: "テスト銀行" } }),
    prisma.linkedAccount.create({
      data: {
        tenantId,
        name: "テストカード",
        type: "CREDIT_CARD",
        institution: "テスト",
        accountId: cardLiabilityId,
      },
    }),
    prisma.linkedAccount.create({
      data: { tenantId, name: "テスト電子マネー", type: "E_MONEY", institution: "テスト" },
    }),
  ]);
  bankId = bank.id;
  creditCardId = credit.id;
  eMoneyId = eMoney.id;
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.ledgerEntry.deleteMany({ where });
  await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId } } });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

async function postCardTxn(cardId: number, date: string, description: string, amount: number) {
  const res = await cardTxnPost(
    makeReq("POST", `http://x/api/linked-accounts/${cardId}/transactions`, {
      date,
      description,
      amount,
    }),
    params(cardId),
  );
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

async function postBankTxn(date: string, description: string, amount: number) {
  const res = await bankTxnPost(
    makeReq("POST", `http://x/api/bank-accounts/${bankId}/transactions`, {
      date,
      description,
      amount,
    }),
    params(bankId),
  );
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

describe("カード明細の符号と応答の形", () => {
  it("+利用で登録すると表には出金（負）で入り、API は +利用・accountId で返す", async () => {
    const created = await postCardTxn(creditCardId, "2031-03-05", "スーパー", 1_200);
    expect(created.amount).toBe(1_200);
    expect(created.accountId).toBe(creditCardId);
    expect(created.transferToAccountId).toBeNull();

    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.kind).toBe("CARD");
    expect(row.cardAccountId).toBe(creditCardId);
    expect(row.bankAccountId).toBeNull();
    expect(Number(row.amount)).toBe(-1_200);

    const list = await (await cardTxnGet(makeReq("GET", "http://x"), params(creditCardId))).json();
    const listed = list.data.find((t: { id: number }) => t.id === created.id);
    expect(listed.amount).toBe(1_200);
    expect(listed.transferToAccount).toBeNull();
  });

  it("カードの転記は Dr 費用 / Cr カードの科目（LIABILITY）の仕訳で、実績は支出が正", async () => {
    const created = await postCardTxn(creditCardId, "2031-03-06", "八百屋", 800);
    const res = await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expenseId, post: true }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.amount).toBe(800);
    expect(body.data.postedRecordId).not.toBeNull();

    const record = await prisma.financialRecord.findUniqueOrThrow({
      where: { id: body.data.postedRecordId },
      include: { journalEntry: { include: { details: true } } },
    });
    expect(record.accountId).toBe(expenseId);
    expect(Number(record.amount)).toBe(800);
    const details = record.journalEntry!.details;
    expect(details.find((d) => d.side === "debit")?.accountId).toBe(expenseId);
    expect(details.find((d) => d.side === "credit")?.accountId).toBe(cardLiabilityId);
  });

  it("返金（−利用）は表では入金（正）になり、転記すると費用のマイナスになる", async () => {
    const created = await postCardTxn(eMoneyId, "2031-03-07", "返品", -300);
    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(row.amount)).toBe(300);

    const res = await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expenseId, post: true }),
      params(created.id),
    );
    const body = await res.json();
    const record = await prisma.financialRecord.findUniqueOrThrow({
      where: { id: body.data.postedRecordId },
    });
    expect(record.journalEntryId).toBeNull(); // 電子マネーは科目が無いので直接書き込み
    expect(Number(record.amount)).toBe(-300);
  });

  it("銀行の API にカード明細の id を渡しても見つからない（種別で絞る）", async () => {
    const created = await postCardTxn(creditCardId, "2031-03-08", "書店", 500);
    const res = await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expenseId }),
      params(created.id),
    );
    expect(res.status).toBe(404);
  });
});

describe("チャージと振替", () => {
  it("銀行からのチャージを電子マネーの入金と対にでき、銀行明細を消すと対だけ外れる", async () => {
    const out = await postBankTxn("2031-03-10", "電子マネー チャージ", -5_000);
    // 電子マネー側の入金は、カードの API では −利用（入金）
    const incoming = await postCardTxn(eMoneyId, "2031-03-10", "チャージ入金", -5_000);

    const res = await bankCharge(
      makeReq("PATCH", "http://x", { chargeToAccountId: eMoneyId, pairTxnId: incoming.id }),
      params(out.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.chargeToAccountId).toBe(eMoneyId);
    expect(body.data.chargeToAccount).toEqual({ id: eMoneyId, name: "テスト電子マネー" });
    const pair = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: incoming.id } });
    expect(pair.chargeGroupId).toBe(body.data.chargeGroupId);

    const del = await bankTxnDelete(
      makeReq("DELETE", `http://x/api/bank-accounts/${bankId}/transactions?txnId=${out.id}`),
      params(bankId),
    );
    expect(del.status).toBe(200);
    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: incoming.id } });
    expect(after.chargeGroupId).toBeNull();
  });

  it("カードの明細を電子マネーへのチャージにすると、応答は transferToAccountId で返る", async () => {
    const created = await postCardTxn(creditCardId, "2031-03-11", "[信] チャージ", 3_000);
    const res = await cardTransfer(
      makeReq("PATCH", "http://x", { transferToAccountId: eMoneyId }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.transferToAccountId).toBe(eMoneyId);
    expect(body.data.transferToAccount).toEqual({ id: eMoneyId, name: "テスト電子マネー" });
    expect(body.data.amount).toBe(3_000);
    const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.chargeToCardId).toBe(eMoneyId);
  });

  it("銀行どうしの出金と入金を振替として紐付けられる", async () => {
    const other = await prisma.bankAccount.create({
      data: { tenantId, name: "貯蓄口座", bankName: "テスト銀行" },
    });
    const out = await postBankTxn("2031-03-12", "振替", -10_000);
    const created = await prisma.ledgerEntry.create({
      data: {
        tenantId,
        kind: "BANK",
        bankAccountId: other.id,
        date: new Date("2031-03-12"),
        description: "振替入金",
        amount: 10_000,
      },
    });
    const res = await transferLink(
      makeReq("POST", "http://x", { outTxnId: out.id, inTxnId: created.id }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((t: { accountId: number }) => t.accountId)).toEqual([bankId, other.id]);
    expect(
      await prisma.ledgerEntry.count({ where: { transferGroupId: body.transferGroupId } }),
    ).toBe(2);
  });
});
