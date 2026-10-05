/**
 * 実績の確定 結合テスト（実 DB 使用）
 *
 * 月ごとの流れ「① 予算確定 → ② 実績確定 → ③ 翌月の予算確定」を実際のルートハンドラ経由で確かめる。
 *   - 明細の最終日（銀行・カード・電子マネー）が月末日までそろうと「実績入力済み」になる
 *   - 予算が未確定・明細が足りない月は実績を確定できない
 *   - 前月の実績が未確定なら翌月の予算を確定できない
 *   - 実績を確定した月は、実績の登録・変更・削除・CSV 取込・仕訳・明細の転記を受け付けない
 *   - 解除は確定と逆の順で、admin のみ
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
import { importRows } from "@/lib/import";
import { POST as actualsConfirmPost, DELETE as actualsConfirmDelete } from "./confirm/route";
import { GET as varianceGet } from "../budgets/variance/route";
import { GET as cycleStatusGet } from "../cycle-status/route";
import { GET as cycleLatestGet } from "../cycle-status/latest/route";
import { POST as budgetConfirmPost, DELETE as budgetConfirmDelete } from "../budgets/confirm/route";
import { POST as financialsPost } from "../financials/route";
import { PATCH as financialPatch, DELETE as financialDelete } from "../financials/[id]/route";
import { POST as journalsPost } from "../journals/route";
import { PATCH as bankCategorize } from "../bank-transactions/[id]/categorize/route";

const SUFFIX = `ac_${Date.now()}`;
const YEAR = 2097; // 他のテストと衝突しない専用の年度

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let admin: { id: number; email: string; name: string; role: string; tenantId: number };
let editor: typeof admin;
let food: { id: number; code: string };
let cash: { id: number; code: string };
let mayRecordId: number;
let bankTxnId: number;
let cardId: number;
let bankId: number;

async function variance(month: number) {
  const res = await varianceGet(
    makeReq("GET", `http://x/api/budgets/variance?year=${YEAR}&month=${month}`),
    emptyRouteContext(),
  );
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

const confirmActuals = (month: number, noChange?: { kind: "bank" | "card"; id: number }[]) =>
  actualsConfirmPost(
    makeReq("POST", "http://x/api/actuals/confirm", { year: YEAR, month, noChange }),
    emptyRouteContext(),
  );
const unconfirmActuals = (month: number) =>
  actualsConfirmDelete(
    makeReq("DELETE", `http://x/api/actuals/confirm?year=${YEAR}&month=${month}`),
    emptyRouteContext(),
  );
const confirmBudget = (month: number) =>
  budgetConfirmPost(
    makeReq("POST", "http://x/api/budgets/confirm", { year: YEAR, month, items: [] }),
    emptyRouteContext(),
  );
const unconfirmBudget = (month: number) =>
  budgetConfirmDelete(
    makeReq("DELETE", `http://x/api/budgets/confirm?year=${YEAR}&month=${month}`),
    emptyRouteContext(),
  );
const postFinancial = () =>
  financialsPost(
    makeReq("POST", "http://x/api/financials", {
      accountCode: food.code,
      fiscalYear: YEAR,
      month: 5,
      amount: 1_000,
    }),
    emptyRouteContext(),
  );

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "budgets",
    "audit_logs",
    "bank_accounts",
    "bank_transactions",
    "linked_accounts",
    "card_transactions",
    "financial_records",
  ]) {
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

  food = await prisma.account.create({
    data: { tenantId, code: `F_${SUFFIX}`, name: "食費", category: "EXPENSE" },
  });
  cash = await prisma.account.create({
    data: { tenantId, code: `C_${SUFFIX}`, name: "現金", category: "ASSET" },
  });

  const may = await prisma.period.create({
    data: { tenantId, fiscalYear: YEAR, month: 5, quarter: 2 },
  });
  await prisma.budget.create({
    data: { tenantId, accountId: food.id, periodId: may.id, amount: 50_000 },
  });
  const record = await prisma.financialRecord.create({
    data: { tenantId, accountId: food.id, periodId: may.id, amount: 42_000 },
  });
  mayRecordId = record.id;

  // 銀行は月末日まで届いている（未転記の出金が 1 件）
  const bank = await prisma.bankAccount.create({
    data: { tenantId, name: "給与口座", bankName: "テスト銀行" },
  });
  const bankTxn = await prisma.bankTransaction.create({
    data: {
      accountId: bank.id,
      date: new Date(YEAR, 4, 31),
      description: "スーパー",
      amount: -3_000,
      categoryAccountId: food.id,
    },
  });
  bankTxnId = bankTxn.id;
  bankId = bank.id;

  // カードは 5/20 で止まっている（未転記 1 件）。電子マネーは明細なし
  const card = await prisma.linkedAccount.create({
    data: { tenantId, name: "テストカード", type: "CREDIT_CARD", institution: "テスト" },
  });
  cardId = card.id;
  await prisma.cardTransaction.create({
    data: { accountId: card.id, date: new Date(YEAR, 4, 20), description: "書店", amount: 1_500 },
  });
  await prisma.linkedAccount.create({
    data: { tenantId, name: "テスト電子マネー", type: "E_MONEY", institution: "テスト" },
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.budgetConfirmation.deleteMany({ where });
  await prisma.budgetHistory.deleteMany({ where });
  await prisma.budget.deleteMany({ where });
  await prisma.cardTransaction.deleteMany({ where: { account: { tenantId } } });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.bankTransaction.deleteMany({ where: { account: { tenantId } } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId } } });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, editor.id] } } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("実績の確定", () => {
  it("予実対比: 明細の最終日をソースごとに返し、遅れているソースがあれば入力待ち", async () => {
    actingUser = editor;
    const data = await variance(5);
    expect(data.actuals).toMatchObject({
      confirmedAt: null,
      entered: false,
      coveredThrough: `${YEAR}-05-20`,
      monthEnd: `${YEAR}-05-31`,
      lagging: [{ kind: "card", id: cardId }],
      unposted: 2,
    });
    const byName = Object.fromEntries(
      data.actuals.sources.map((s: { name: string; lastDate: string | null }) => [
        s.name,
        s.lastDate,
      ]),
    );
    expect(byName).toEqual({
      給与口座: `${YEAR}-05-31`,
      テストカード: `${YEAR}-05-20`,
      テスト電子マネー: null,
    });
    expect(data.prevActualsPending).toBe(false);
  });

  it("① 予算が未確定の月は、実績を確定できない（409）", async () => {
    actingUser = editor;
    expect((await confirmActuals(5)).status).toBe(409);
  });

  it("① 前月の予算が未確定（サイクルの初回）なら、予算はそのまま確定できる", async () => {
    actingUser = editor;
    expect((await confirmBudget(5)).status).toBe(201);
  });

  it("③ 当月の実績が未確定なら、翌月の予算は確定できない（409）", async () => {
    actingUser = editor;
    const res = await confirmBudget(6);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("実績が確定していません");
    expect((await variance(6)).prevActualsPending).toBe(true);
  });

  it("② 明細が月末日までそろっていなければ、実績を確定できない（409）", async () => {
    actingUser = editor;
    const res = await confirmActuals(5);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(`${YEAR}-05-20`);
  });

  it("② 当月末まで変動なし: 届いていないソースすべてに付ければ確定でき、確定時点の状況を記録する", async () => {
    actingUser = editor;
    // 月末まで届いている銀行に付けても意味が無く、カードが残るので確定できない
    const partial = await confirmActuals(5, [{ kind: "bank", id: bankId }]);
    expect(partial.status).toBe(409);
    expect((await partial.json()).error).toContain("テストカードは");

    expect((await confirmActuals(5, [{ kind: "card", id: cardId }])).status).toBe(201);
    const data = await variance(5);
    expect(data.actuals.confirmedAt).not.toBeNull();
    expect(data.actuals.confirmedCoverage).toMatchObject({
      monthEnd: `${YEAR}-05-31`,
      coveredThrough: `${YEAR}-05-20`,
    });
    const marks = Object.fromEntries(
      data.actuals.confirmedCoverage.sources.map(
        (s: { name: string; lastDate: string | null; noChange: boolean }) => [
          s.name,
          [s.lastDate, s.noChange],
        ],
      ),
    );
    expect(marks).toEqual({
      給与口座: [`${YEAR}-05-31`, false],
      テストカード: [`${YEAR}-05-20`, true],
      テスト電子マネー: [null, false],
    });

    // 次のテストのために確定を外す（解除は admin のみ）。解除すると記録も無くなる
    actingUser = admin;
    expect((await unconfirmActuals(5)).status).toBe(204);
    actingUser = editor;
    expect((await variance(5)).actuals.confirmedCoverage).toBeNull();
  });

  it("② 全ソースが月末日まで届くと入力済みになり、実績を確定できる", async () => {
    actingUser = editor;
    await prisma.cardTransaction.create({
      data: { accountId: cardId, date: new Date(YEAR, 5, 2), description: "書店", amount: 800 },
    });
    const before = await variance(5);
    expect(before.actuals.entered).toBe(true);
    expect(before.actuals.lagging).toEqual([]);

    expect((await confirmActuals(5)).status).toBe(201);
    expect((await confirmActuals(5)).status).toBe(409); // 二重確定
    expect((await variance(5)).actuals.confirmedAt).not.toBeNull();

    // 最後に実績を確定した月（予実差確認などの既定の月に使う）
    const latest = await cycleLatestGet(
      makeReq("GET", "http://x/api/cycle-status/latest"),
      emptyRouteContext(),
    );
    expect((await latest.json()).data).toEqual({ lastActualsConfirmed: `${YEAR}-05` });
  });

  it("実績を確定した月は、実績の登録・変更・削除を受け付けない（409）", async () => {
    actingUser = editor;
    expect((await postFinancial()).status).toBe(409);
    const patch = await financialPatch(
      makeReq("PATCH", `http://x/api/financials/${mayRecordId}`, { amount: 1 }),
      params(mayRecordId),
    );
    expect(patch.status).toBe(409);
    const del = await financialDelete(
      makeReq("DELETE", `http://x/api/financials/${mayRecordId}`),
      params(mayRecordId),
    );
    expect(del.status).toBe(409);
    const rec = await prisma.financialRecord.findUnique({ where: { id: mayRecordId } });
    expect(Number(rec?.amount)).toBe(42_000);
  });

  it("実績を確定した月へは、CSV 取込・仕訳・明細の転記もできない", async () => {
    actingUser = editor;
    const imported = await importRows(
      [{ accountCode: food.code, fiscalYear: YEAR, month: 5, amount: 100 }],
      tenantId,
    );
    expect(imported.inserted).toBe(0);
    expect(imported.errors[0].message).toContain("確定済み");

    const journal = await journalsPost(
      makeReq("POST", "http://x/api/journals", {
        transactionDate: `${YEAR}-05-15`,
        description: "食料品",
        details: [
          { side: "debit", accountId: food.id, amount: 500 },
          { side: "credit", accountId: cash.id, amount: 500 },
        ],
      }),
      emptyRouteContext(),
    );
    expect(journal.status).toBe(409);
    // 実績に反映されない仕訳だけが残らない
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);

    const post = await bankCategorize(
      makeReq("PATCH", `http://x/api/bank-transactions/${bankTxnId}/categorize`, { post: true }),
      params(bankTxnId),
    );
    expect(post.status).toBe(409);
    const txn = await prisma.bankTransaction.findUnique({ where: { id: bankTxnId } });
    expect(txn?.postedRecordId).toBeNull();
  });

  it("③ 当月の実績を確定すると、翌月の予算を確定できる", async () => {
    actingUser = editor;
    expect((await confirmBudget(6)).status).toBe(201);
  });

  it("GET /api/cycle-status: ①②③ の状況と明細の最終日を、予実対比と同じ形で返す", async () => {
    actingUser = editor;
    const res = await cycleStatusGet(
      makeReq("GET", `http://x/api/cycle-status?year=${YEAR}&month=5`),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      year: YEAR,
      month: 5,
      next: { year: YEAR, month: 6 },
      prevActualsPending: false,
      actuals: { entered: true, monthEnd: `${YEAR}-05-31`, unposted: 2 },
    });
    expect(data.confirmedAt).not.toBeNull();
    expect(data.actuals.confirmedAt).not.toBeNull();
    expect(data.nextConfirmedAt).not.toBeNull();
    expect(data.actuals.sources).toHaveLength(3);
    // 予実対比も同じ確定状況を返す
    const v = await variance(5);
    expect(v.nextConfirmedAt).toBe(data.nextConfirmedAt);
    expect(v.actuals).toEqual(data.actuals);
    // 6 月から見ると、前月（5 月）の実績は確定済み
    const june = await (
      await cycleStatusGet(
        makeReq("GET", `http://x/api/cycle-status?year=${YEAR}&month=6`),
        emptyRouteContext(),
      )
    ).json();
    expect(june.data.prevActualsPending).toBe(false);
  });

  it("解除は逆順・admin のみ: 予算 → 実績の順には外せず、翌月予算 → 実績 → 予算の順で外せる", async () => {
    actingUser = editor;
    expect((await unconfirmActuals(5)).status).toBe(403);

    actingUser = admin;
    // 実績が確定済みの月の予算は外せない
    expect((await unconfirmBudget(5)).status).toBe(409);
    // 翌月の予算が確定済みなら実績は外せない
    expect((await unconfirmActuals(5)).status).toBe(409);

    expect((await unconfirmBudget(6)).status).toBe(204);
    expect((await unconfirmActuals(5)).status).toBe(204);
    expect((await unconfirmBudget(5)).status).toBe(204);

    // 解除後は実績を登録できる
    actingUser = editor;
    expect((await postFinancial()).status).toBe(201);
  });
});
