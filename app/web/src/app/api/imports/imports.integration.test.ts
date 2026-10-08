/**
 * 実績管理の CSV インポート（銀行・カードの明細）結合テスト（実 DB 使用）
 *
 * - 登録先の列（target・account）つきの CSV を、銀行・カードに振り分けて登録する
 * - 学習ルールに当たった明細には科目が付き、そのまま実績になる
 * - 列の無い CSV は、指定した登録先（target・accountId）に入れる
 * - 実績の行（target=実績）・target=actual は受け付けない
 * - 実績を確定済みの月の行は飛ばす
 * - 誤りのある行があれば、どの行も登録しない
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
import { POST as importPost } from "./route";

const SUFFIX = `imp_${Date.now()}`;
const code = `H${SUFFIX}`;

function csvReq(query: string, csv: string) {
  return {
    method: "POST",
    nextUrl: new URL(`http://localhost:3000/api/imports${query}`),
    text: () => Promise.resolve(csv),
    json: () => Promise.resolve({}),
    headers: new Headers({ "Content-Type": "text/csv", "content-length": String(csv.length) }),
  } as unknown as import("next/server").NextRequest;
}

let tenantId: number;
let bankId: number;
let cardId: number;
let salaryId: number;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "bank_accounts", "linked_accounts"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  actingUser = await prisma.user.create({
    data: {
      tenantId,
      email: `e_${SUFFIX}@example.com`,
      name: "e",
      passwordHash: "x",
      role: "editor",
    },
  });
  salaryId = (
    await prisma.account.create({ data: { tenantId, code, name: "給与", category: "REVENUE" } })
  ).id;
  // 摘要「給与」の明細には、取り込み時に給与の科目が付く
  await prisma.txnCategoryRule.create({
    data: { tenantId, keyword: "給与", categoryAccountId: salaryId, priority: 100 },
  });
  bankId = (
    await prisma.bankAccount.create({
      data: { tenantId, name: "テスト普通", bankName: "テスト銀行" },
    })
  ).id;
  cardId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "テストカード", type: "CREDIT_CARD", institution: "テスト" },
    })
  ).id;
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("POST /api/imports", () => {
  it("登録先の列つきの CSV を、銀行・カードに振り分け、学習ルールに当たった明細は実績になる", async () => {
    const csv = [
      "target,account,date,description,amount",
      "銀行,テスト普通,2031-04-25,給与,300000",
      "カード,テストカード,2031-04-27,スーパー,-3980",
    ].join("\n");
    const res = await importPost(csvReq("", csv), emptyRouteContext());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.results.actual).toBeNull();
    expect(body.results.bank).toMatchObject([{ id: bankId, inserted: 1, locked: 0 }]);
    expect(body.results.card).toMatchObject([{ id: cardId, inserted: 1 }]);

    // 給与は学習ルールで科目が付き、その行がそのまま実績（収入は入金が正）
    const salary = await prisma.financialRecord.findFirstOrThrow({
      where: { bankAccountId: bankId },
      include: { period: true },
    });
    expect([salary.accountId, Number(salary.amount), Number(salary.flow)]).toEqual([
      salaryId,
      300000,
      300000,
    ]);
    expect([salary.period.fiscalYear, salary.period.month]).toEqual([2031, 4]);
    // ルールに当たらないカードの明細は未割り当て（実績の金額は 0）。flow は CSV のまま負
    const card = await prisma.financialRecord.findFirstOrThrow({
      where: { cardAccountId: cardId },
    });
    expect([card.accountId, Number(card.amount), Number(card.flow)]).toEqual([null, 0, -3980]);
  });

  it("実績の行・target=actual は受け付けない", async () => {
    const routed = await importPost(
      csvReq("", `target,account,date,description,amount,accountCode\n実績,,2031-04-30,,1,${code}`),
      emptyRouteContext(),
    );
    expect(routed.status).toBe(400);
    const direct = await importPost(
      csvReq("?target=actual", `accountCode,fiscalYear,month,amount\n${code},2031,4,1`),
      emptyRouteContext(),
    );
    expect(direct.status).toBe(410);
  });

  it("実績を確定済みの月の行は飛ばす", async () => {
    const period = await prisma.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: 2031, month: 7 } },
      update: {},
      create: { tenantId, fiscalYear: 2031, month: 7, quarter: 3 },
    });
    await prisma.actualsConfirmation.create({
      data: { tenantId, periodId: period.id, confirmedById: actingUser.id },
    });
    const csv = "date,description,amount\n2031-07-10,確定済みの月,-500\n2031-08-10,翌月,-600";
    const res = await importPost(
      csvReq(`?target=bank&accountId=${bankId}`, csv),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.results.bank).toMatchObject([{ id: bankId, inserted: 1, skipped: 0, locked: 1 }]);
    expect(
      await prisma.financialRecord.count({
        where: { bankAccountId: bankId, description: "確定済みの月" },
      }),
    ).toBe(0);
  });

  it("列の無い CSV は、指定した登録先に入れる（同じ明細は重複として飛ばす）", async () => {
    const csv = "date,description,amount\n2031-05-01,振込,1000\n2031-04-25,給与,300000";
    const res = await importPost(
      csvReq(`?target=bank&accountId=${bankId}`, csv),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.results.bank).toMatchObject([{ id: bankId, inserted: 1, skipped: 1 }]);
  });

  it("誤りのある行があれば、どの行も登録しない", async () => {
    const before = await prisma.financialRecord.count({ where: { bankAccountId: bankId } });
    const csv = [
      "target,account,date,description,amount",
      "銀行,テスト普通,2031-06-01,家賃,-80000",
      "銀行,無い口座,2031-06-02,x,1",
    ].join("\n");
    const res = await importPost(csvReq("", csv), emptyRouteContext());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3]);
    expect(await prisma.financialRecord.count({ where: { bankAccountId: bankId } })).toBe(before);
  });
});
