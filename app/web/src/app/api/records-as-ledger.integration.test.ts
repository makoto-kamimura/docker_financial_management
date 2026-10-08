/**
 * 実績と明細を 1 つの表（financial_records）にまとめた動きの結合テスト（実 DB 使用）
 *
 *   - 明細（現金・銀行・カード）は実績の表の 1 行。科目を付けた行がそのまま実績になる（写しは作らない）
 *   - flow は +入金 / −出金、amount は科目の向きの実績の金額（科目が無ければ 0）
 *   - カードの API は以前どおり +利用 / −返金で受け取り・返す
 *   - 振替・チャージにすると科目が外れて実績から抜ける
 *   - 実績を確定済みの月の明細は、登録・削除・科目の変更ができない
 *   - 登録時の科目（省略時は学習ルール）・同じ日・同じ金額の組の自動相殺・未割り当ての一覧・まとめての処理
 *
 * 実行: `npm run test:integration`
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
import { GET as matrixGet } from "./financials/matrix/route";
import { DELETE as cashDelete, GET as cashGet, POST as cashPost } from "./actuals/route";
import { PATCH as cashCategorize } from "./actuals/[id]/categorize/route";
import { GET as unassignedGet } from "./ledger/unassigned/route";
import { POST as autoProcessPost } from "./ledger/auto-process/route";

const SUFFIX = `ledger_${Date.now()}`;
const YEAR = 2032;

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
let expense: { id: number; code: string };
let other: { id: number; code: string };
let salary: { id: number; code: string };
let bankId: number;
let creditCardId: number;
let eMoneyId: number;

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
      name: "明細テスト",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  const mk = (code: string, name: string, category: "EXPENSE" | "REVENUE") =>
    prisma.account.create({ data: { tenantId, code: `${code}_${SUFFIX}`, name, category } });
  [expense, other, salary] = await Promise.all([
    mk("EXP", "食費", "EXPENSE"),
    mk("OTH", "日用品", "EXPENSE"),
    mk("REV", "給与", "REVENUE"),
  ]);

  const [bank, credit, eMoney] = await Promise.all([
    prisma.bankAccount.create({ data: { tenantId, name: "給与口座", bankName: "テスト銀行" } }),
    prisma.linkedAccount.create({
      data: { tenantId, name: "テストカード", type: "CREDIT_CARD", institution: "テスト" },
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
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.journalEntry.deleteMany({ where });
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

const row = (id: number) => prisma.financialRecord.findUniqueOrThrow({ where: { id } });

describe("科目を付けた明細がそのまま実績になる", () => {
  it("カードは +利用で登録・応答し、行の flow は出金（負）。登録した時点では未割り当て", async () => {
    const created = await postCardTxn(creditCardId, `${YEAR}-03-05`, "スーパー", 1_200);
    expect(created).toMatchObject({
      amount: 1_200,
      accountId: creditCardId,
      categoryAccountId: null,
    });

    const r = await row(created.id);
    expect([r.kind, r.cardAccountId, Number(r.flow), r.accountId, Number(r.amount)]).toEqual([
      "CARD",
      creditCardId,
      -1_200,
      null,
      0,
    ]);

    const list = await (await cardTxnGet(makeReq("GET", "http://x"), params(creditCardId))).json();
    expect(list.data.find((t: { id: number }) => t.id === created.id).amount).toBe(1_200);
  });

  it("科目を付けると、その行が実績になる（仕訳や写しの行は作らない）。変える・外すと追随する", async () => {
    const created = await postCardTxn(creditCardId, `${YEAR}-03-06`, "八百屋", 800);
    const res = await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expense.id }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.categoryAccountId).toBe(expense.id);
    let r = await row(created.id);
    expect([r.accountId, Number(r.amount)]).toEqual([expense.id, 800]);
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.financialRecord.count({ where: { tenantId, accountId: expense.id } })).toBe(
      1,
    );

    await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: other.id }),
      params(created.id),
    );
    r = await row(created.id);
    expect([r.accountId, Number(r.amount)]).toEqual([other.id, 800]);

    await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: null }),
      params(created.id),
    );
    r = await row(created.id);
    expect([r.accountId, Number(r.amount)]).toEqual([null, 0]);
  });

  it("返金は費用のマイナス、収入科目の入金は収入のプラスになる", async () => {
    const refund = await postCardTxn(eMoneyId, `${YEAR}-03-07`, "返品", -300);
    await cardCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expense.id }),
      params(refund.id),
    );
    expect(Number((await row(refund.id)).amount)).toBe(-300);

    const pay = await postBankTxn(`${YEAR}-03-25`, "給与振込", 300_000);
    await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: salary.id }),
      params(pay.id),
    );
    expect(Number((await row(pay.id)).amount)).toBe(300_000);
  });

  it("科目を付けると学習し、同じ摘要の未割り当ての明細にも同じ科目が付く", async () => {
    const a = await postBankTxn(`${YEAR}-04-01`, "ドラッグストア", -1_000);
    const b = await postBankTxn(`${YEAR}-04-15`, "ドラッグストア", -2_000);
    const res = await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: other.id, learn: true }),
      params(a.id),
    );
    expect((await res.json()).updatedSiblingCount).toBe(1);
    const rb = await row(b.id);
    expect([rb.accountId, Number(rb.amount)]).toEqual([other.id, 2_000]);
    expect(
      await prisma.txnCategoryRule.count({ where: { tenantId, categoryAccountId: other.id } }),
    ).toBe(1);
  });

  it("科目×月の表は明細を実績として返し、1 件のセルも内訳（出どころ）を持つ", async () => {
    const res = await matrixGet(
      makeReq("GET", `http://x/api/financials/matrix?year=${YEAR}`),
      emptyRouteContext(),
    );
    const body = await res.json();
    const salaryRows = body.data.filter(
      (r: { account: { id: number } }) => r.account.id === salary.id,
    );
    expect(salaryRows).toHaveLength(1);
    expect(salaryRows[0]).toMatchObject({
      amount: 300_000,
      period: { fiscalYear: YEAR, month: 3 },
      source: { kind: "bank", description: "給与振込", accountName: "給与口座" },
    });
    // 未割り当ての明細は表に出ない
    expect(body.data.every((r: { account: unknown }) => r.account !== null)).toBe(true);
  });

  it("銀行の API にカードの明細の id を渡しても見つからない（種別で絞る）", async () => {
    const created = await postCardTxn(creditCardId, `${YEAR}-03-08`, "書店", 500);
    const res = await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expense.id }),
      params(created.id),
    );
    expect(res.status).toBe(404);
  });
});

describe("振替・チャージにすると実績から抜ける", () => {
  it("銀行からのチャージを電子マネーの入金と対にすると、どちらも科目が外れる", async () => {
    const out = await postBankTxn(`${YEAR}-05-10`, "電子マネー チャージ", -5_000);
    await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expense.id }),
      params(out.id),
    );
    // 日付がずれていると自動相殺にはかからないので、手で組にする
    const incoming = await postCardTxn(eMoneyId, `${YEAR}-05-11`, "チャージ入金", -5_000);

    const res = await bankCharge(
      makeReq("PATCH", "http://x", { chargeToAccountId: eMoneyId, pairTxnId: incoming.id }),
      params(out.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ chargeToAccountId: eMoneyId, categoryAccountId: null });
    const r = await row(out.id);
    expect([r.accountId, Number(r.amount)]).toEqual([null, 0]);
    expect((await row(incoming.id)).chargeGroupId).toBe(body.data.chargeGroupId);

    // 銀行の明細を消すと、対だけ外れる
    const del = await bankTxnDelete(
      makeReq("DELETE", `http://x/api/bank-accounts/${bankId}/transactions?txnId=${out.id}`),
      params(bankId),
    );
    expect(del.status).toBe(200);
    expect((await row(incoming.id)).chargeGroupId).toBeNull();
  });

  it("カードの明細を電子マネーへのチャージにすると、応答は transferToAccountId で返る", async () => {
    const created = await postCardTxn(creditCardId, `${YEAR}-05-11`, "[信] チャージ", 3_000);
    const res = await cardTransfer(
      makeReq("PATCH", "http://x", { transferToAccountId: eMoneyId }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ transferToAccountId: eMoneyId, amount: 3_000 });
    expect(body.data.transferToAccount).toEqual({ id: eMoneyId, name: "テスト電子マネー" });
  });

  it("銀行どうしの出金と入金を振替として紐付けると、科目が外れる", async () => {
    const savings = await prisma.bankAccount.create({
      data: { tenantId, name: "貯蓄口座", bankName: "テスト銀行" },
    });
    const out = await postBankTxn(`${YEAR}-05-12`, "振替", -10_000);
    await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: other.id }),
      params(out.id),
    );
    const inRes = await bankTxnPost(
      makeReq("POST", `http://x/api/bank-accounts/${savings.id}/transactions`, {
        // 日付がずれていると自動相殺にはかからないので、手で組にする
        date: `${YEAR}-05-13`,
        description: "振替入金",
        amount: 10_000,
      }),
      params(savings.id),
    );
    const income = (await inRes.json()).data;
    const res = await transferLink(
      makeReq("POST", "http://x", { outTxnId: out.id, inTxnId: income.id }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((t: { accountId: number }) => t.accountId)).toEqual([bankId, savings.id]);
    const r = await row(out.id);
    expect([r.accountId, Number(r.amount), r.transferGroupId]).toEqual([
      null,
      0,
      body.transferGroupId,
    ]);
  });
});

describe("現金の明細", () => {
  it("科目つきで登録すると実績になり、月で取得・科目の変更・削除ができる", async () => {
    const res = await cashPost(
      makeReq("POST", "http://x/api/actuals", {
        date: `${YEAR}-06-03`,
        description: "八百屋",
        accountCode: expense.code,
        amount: 650,
        direction: "expense",
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created).toMatchObject({ amount: -650, categoryAccountId: expense.id });
    let r = await row(created.id);
    expect([r.kind, r.accountId, Number(r.amount)]).toEqual(["CASH", expense.id, 650]);

    const month = await (
      await cashGet(
        makeReq("GET", `http://x/api/actuals?year=${YEAR}&month=6`),
        emptyRouteContext(),
      )
    ).json();
    expect(month.data.map((e: { id: number }) => e.id)).toEqual([created.id]);

    await cashCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: other.id }),
      params(created.id),
    );
    r = await row(created.id);
    expect([r.accountId, Number(r.amount)]).toEqual([other.id, 650]);

    const del = await cashDelete(
      makeReq("DELETE", `http://x/api/actuals?id=${created.id}`),
      emptyRouteContext(),
    );
    expect(del.status).toBe(200);
    expect(await prisma.financialRecord.count({ where: { id: created.id } })).toBe(0);
  });
});

describe("実績を確定済みの月", () => {
  it("明細の登録・科目の変更・削除は 409", async () => {
    const created = await postBankTxn(`${YEAR}-07-05`, "確定前の明細", -700);
    const period = await prisma.period.findUniqueOrThrow({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: YEAR, month: 7 } },
    });
    await prisma.actualsConfirmation.create({
      data: { tenantId, periodId: period.id, confirmedById: actingUser.id },
    });

    const add = await bankTxnPost(
      makeReq("POST", `http://x/api/bank-accounts/${bankId}/transactions`, {
        date: `${YEAR}-07-20`,
        description: "確定後",
        amount: -100,
      }),
      params(bankId),
    );
    expect(add.status).toBe(409);
    const cat = await bankCategorize(
      makeReq("PATCH", "http://x", { categoryAccountId: expense.id }),
      params(created.id),
    );
    expect(cat.status).toBe(409);
    const del = await bankTxnDelete(
      makeReq("DELETE", `http://x/api/bank-accounts/${bankId}/transactions?txnId=${created.id}`),
      params(bankId),
    );
    expect(del.status).toBe(409);
    const r = await row(created.id);
    expect([r.accountId, Number(r.amount)]).toEqual([null, 0]);
  });
});

describe("登録時の科目・自動相殺・未割り当て・まとめての処理", () => {
  it("カレンダーの登録で科目を選ぶと、その明細がそのまま実績になる。省略すると学習ルールで決まる", async () => {
    const chosen = await bankTxnPost(
      makeReq("POST", `http://x/api/bank-accounts/${bankId}/transactions`, {
        date: `${YEAR}-08-01`,
        description: "米屋",
        amount: -2_000,
        categoryAccountId: expense.id,
      }),
      params(bankId),
    );
    const chosenRow = await row((await chosen.json()).data.id);
    expect([chosenRow.accountId, Number(chosenRow.amount)]).toEqual([expense.id, 2_000]);

    // 4 月の操作で「ドラッグストア」を学習済み
    const learned = await postCardTxn(creditCardId, `${YEAR}-08-02`, "ドラッグストア", 900);
    expect(learned.categoryAccountId).toBe(other.id);
    expect(Number((await row(learned.id)).amount)).toBe(900);

    const unknown = await postBankTxn(`${YEAR}-08-03`, "初めての店", -100);
    expect(unknown.categoryAccountId).toBeNull();
  });

  it("同じ日・同じ金額の銀行からの出金と電子マネーへの入金を登録すると、自動でチャージの組になる", async () => {
    const out = await postBankTxn(`${YEAR}-08-10`, "電子マネーへ", -7_000);
    // 電子マネーの入金（カードの API では −利用）
    const incoming = await postCardTxn(eMoneyId, `${YEAR}-08-10`, "チャージ", -7_000);
    expect(incoming.chargeGroupId).not.toBeNull();
    const o = await row(out.id);
    expect([o.chargeToCardId, o.chargeGroupId, o.accountId]).toEqual([
      eMoneyId,
      incoming.chargeGroupId,
      null,
    ]);
  });

  it("未割り当ての一覧に出て、残っていると確定できない。まとめて自動処理で学習ルールの科目が付く", async () => {
    const res = await unassignedGet(
      makeReq("GET", `http://x/api/ledger/unassigned?year=${YEAR}&month=8`),
      emptyRouteContext(),
    );
    const list = (await res.json()).data;
    expect(list.map((e: { description: string }) => e.description)).toEqual(["初めての店"]);
    expect(list[0]).toMatchObject({ kind: "BANK", amount: -100, sourceName: "給与口座" });

    // あとから学習ルールを足して、まとめて自動処理する
    await prisma.txnCategoryRule.create({
      data: { tenantId, keyword: "初めての店", categoryAccountId: other.id, priority: 100 },
    });
    const processed = await autoProcessPost(
      makeReq("POST", "http://x/api/ledger/auto-process"),
      emptyRouteContext(),
    );
    expect(processed.status).toBe(200);
    const result = (await processed.json()).data;
    expect(result.categorized).toBeGreaterThanOrEqual(1);
    const after = await (
      await unassignedGet(
        makeReq("GET", `http://x/api/ledger/unassigned?year=${YEAR}&month=8`),
        emptyRouteContext(),
      )
    ).json();
    expect(after.data).toEqual([]);
  });
});
