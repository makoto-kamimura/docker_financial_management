/**
 * 実績管理の取り込み（銀行・カードの明細の CSV）結合テスト（実 DB 使用）
 *
 * - 選んだ口座・カード（target・accountId）に入れ、学習ルールに当たった明細には科目が付き、そのまま実績になる
 * - 同じ明細は重複として飛ばす
 * - 同じ日・同じ金額の口座どうしの出金と入金は、振替の組にする
 * - 現金（target=cash）・target=actual は受け付けない。取り込み先の列は読まない。口座が無ければ 404
 * - 口座・カードごとの明細の API は CSV を受けない（取り込みの入口はここだけ）
 * - 結果の unassigned は、科目も振替・チャージの組も付いていない件数
 * - GET /api/imports/coverage は、CSV・自動取得で入った明細のいちばん新しい日付を返す（手入力は数えない）
 * - dryRun=1 は書き込まず（期間も作らない）、件数・取り込み済みかもしれない明細・残高の照合を返し、件数は本体と一致する
 * - 実績を確定済みの月の行は飛ばす
 * - 誤りのある行があれば、どの行も登録しない
 * - 同じ日・同じ摘要・同じ金額の行は別の明細として入り、期間の重なる CSV を後から入れても二重には入らない
 * - 各社の明細の CSV を画面でそろえた形（lib/shared/statement-formats.ts）は、そのまま取り込め、2 回目は重複になる
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
import { createTestEntry } from "@/lib/ledger/test-entries";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { POST as importPost } from "./route";
import { GET as coverageGet } from "./coverage/route";
import { POST as bankTxnPost } from "../bank-accounts/[id]/transactions/route";
import { POST as cardTxnPost } from "../linked-accounts/[id]/transactions/route";
import { convertStatement, decodeCsv, toImportCsv } from "@/lib/shared/statement-formats";

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
let savingsId: number;
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
  savingsId = (
    await prisma.bankAccount.create({
      data: { tenantId, name: "テスト貯蓄", bankName: "テスト銀行" },
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
  const bank = (id = bankId) => `?target=bank&accountId=${id}`;

  it("選んだ口座・カードに入れ、学習ルールに当たった明細は実績になる", async () => {
    const res = await importPost(
      csvReq(bank(), "日付,摘要,金額,残高\n2031-04-25,給与,300000,500000"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    // 給与は学習ルールで科目が付くので、未割り当ては 0
    expect((await res.json()).result).toEqual({
      inserted: 1,
      skipped: 0,
      locked: 0,
      offset: 0,
      unassigned: 0,
    });
    const cardRes = await importPost(
      csvReq(
        `?target=card&accountId=${cardId}`,
        "date,description,amount\n2031-04-27,スーパー,-3980",
      ),
      emptyRouteContext(),
    );
    // ルールに当たらないスーパーは未割り当て
    expect((await cardRes.json()).result).toMatchObject({ inserted: 1, unassigned: 1 });

    // 給与は学習ルールで科目が付き、その行がそのまま実績（収入は入金が正）。残高も入る
    const salary = await prisma.financialRecord.findFirstOrThrow({
      where: { bankAccountId: bankId },
      include: { period: true },
    });
    expect([salary.accountId, Number(salary.amount), Number(salary.flow)]).toEqual([
      salaryId,
      300000,
      300000,
    ]);
    expect(Number(salary.balance)).toBe(500000);
    expect([salary.period.fiscalYear, salary.period.month]).toEqual([2031, 4]);
    // ルールに当たらない明細は未割り当て（実績の金額は 0）。flow は CSV のまま
    const card = await prisma.financialRecord.findFirstOrThrow({
      where: { cardAccountId: cardId },
    });
    expect([card.accountId, Number(card.amount), Number(card.flow)]).toEqual([null, 0, -3980]);
  });

  it("同じ明細は重複として飛ばす", async () => {
    const csv = "date,description,amount\n2031-05-01,振込,1000\n2031-04-25,給与,300000";
    const res = await importPost(csvReq(bank(), csv), emptyRouteContext());
    expect(res.status).toBe(201);
    expect((await res.json()).result).toMatchObject({ inserted: 1, skipped: 1 });
  });

  it("同じ日・同じ金額の口座どうしの出金と入金は、振替の組にする", async () => {
    await importPost(
      csvReq(bank(), "日付,摘要,金額\n2031-06-05,貯蓄へ,-20000"),
      emptyRouteContext(),
    );
    const res = await importPost(
      csvReq(bank(savingsId), "日付,摘要,金額\n2031-06-05,普通から,20000"),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).result.offset).toBe(1);
    const rows = await prisma.financialRecord.findMany({
      where: { tenantId, date: new Date("2031-06-05") },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].transferGroupId).not.toBeNull();
    expect(rows[0].transferGroupId).toBe(rows[1].transferGroupId);
  });

  it("現金・target=actual は受け付けず、取り込み先の列は読まない。口座が無ければ 404", async () => {
    const cash = await importPost(
      csvReq("?target=cash", "日付,摘要,金額\n2031-04-28,八百屋,-650"),
      emptyRouteContext(),
    );
    expect(cash.status).toBe(410);
    const direct = await importPost(
      csvReq("?target=actual", `accountCode,fiscalYear,month,amount\n${code},2031,4,1`),
      emptyRouteContext(),
    );
    expect(direct.status).toBe(410);
    // 取り込み先の列があっても、選んだ口座に入れる
    const routed = await importPost(
      csvReq(bank(), "取り込み先,日付,摘要,金額\nテストカード,2031-06-20,列つき,-100"),
      emptyRouteContext(),
    );
    expect(routed.status).toBe(201);
    expect(
      await prisma.financialRecord.count({
        where: { bankAccountId: bankId, description: "列つき" },
      }),
    ).toBe(1);
    const missing = await importPost(
      csvReq("?target=bank", "日付,摘要,金額\n2031-06-21,x,-1"),
      emptyRouteContext(),
    );
    expect(missing.status).toBe(404);
  });

  it("口座・カードごとの明細の API は CSV を受けない", async () => {
    const csv = "date,description,amount\n2031-06-22,x,-1";
    const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
    expect((await bankTxnPost(csvReq("", csv), ctx(bankId))).status).toBe(410);
    expect((await cardTxnPost(csvReq("", csv), ctx(cardId))).status).toBe(410);
  });

  it("dryRun=1 は書き込まず、件数・取り込み済みかもしれない明細・残高の照合を返す", async () => {
    const checkId = (
      await prisma.bankAccount.create({
        data: { tenantId, name: "照合用", bankName: "テスト銀行" },
      })
    ).id;
    await importPost(
      csvReq(bank(checkId), "日付,摘要,金額,残高\n2032-01-05,スーパーA,-500,99500"),
      emptyRouteContext(),
    );
    const csv = [
      "日付,摘要,金額,残高",
      "2032-01-05,スーパーA,-500,99500",
      "2032-01-05,スーパーB,-500,99000",
      "2032-01-06,給与,1000,100000",
    ].join("\n");
    const records = () => prisma.financialRecord.count({ where: { tenantId } });
    const before = await records();
    const res = await importPost(csvReq(`${bank(checkId)}&dryRun=1`, csv), emptyRouteContext());
    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(await records()).toBe(before);
    expect(preview).toMatchObject({
      from: "2032-01-05",
      to: "2032-01-06",
      fresh: 2,
      duplicate: 1,
      locked: 0,
      possibleDuplicates: [{ index: 1, description: "スーパーB", existing: ["スーパーA"] }],
      balanceCheck: {
        gaps: [],
        // 初めての取り込み（その日より前の明細が無い）なので、差額を 100,000 にすると合う
        opening: { date: "2032-01-05", csv: 100000, app: 0, diff: 100000, hasEarlier: false },
      },
    });

    // 本体の取り込みの件数と一致する
    const real = await (await importPost(csvReq(bank(checkId), csv), emptyRouteContext())).json();
    expect(real.result).toMatchObject({ inserted: preview.fresh, skipped: preview.duplicate });

    // 残高がつながらない行と、前の明細があるときのずれ
    const gap = await importPost(
      csvReq(
        `${bank(checkId)}&dryRun=1`,
        "日付,摘要,金額,残高\n2032-01-10,A,-100,500\n2032-01-11,B,-100,300",
      ),
      emptyRouteContext(),
    );
    expect((await gap.json()).preview.balanceCheck).toMatchObject({
      gaps: [{ index: 1, date: "2032-01-11", expected: 400, actual: 300 }],
      // アプリの残高は差額 0 + それより前の明細（-500・-500・+1000）の合計 = 0
      opening: { csv: 600, app: 0, diff: 600, hasEarlier: true },
    });
    await prisma.financialRecord.deleteMany({ where: { bankAccountId: checkId } });
  });

  it("dryRun=1 は期間（periods）を作らない", async () => {
    const periods = () => prisma.period.count({ where: { tenantId } });
    const before = await periods();
    const res = await importPost(
      csvReq(`?target=card&accountId=${cardId}&dryRun=1`, "日付,摘要,金額\n2033-02-01,x,-1"),
      emptyRouteContext(),
    );
    expect((await res.json()).preview).toMatchObject({ fresh: 1, balanceCheck: null });
    expect(await periods()).toBe(before);
  });

  it("coverage は、CSV・自動取得で入った明細のいちばん新しい日付を返す（手入力は数えない）", async () => {
    const coverage = async (query: string) =>
      (
        await coverageGet(
          {
            method: "GET",
            nextUrl: new URL(`http://localhost:3000/api/imports/coverage${query}`),
            headers: new Headers(),
          } as unknown as import("next/server").NextRequest,
          emptyRouteContext(),
        )
      ).json();
    const coveredId = (
      await prisma.bankAccount.create({
        data: { tenantId, name: "期間用", bankName: "テスト銀行" },
      })
    ).id;
    expect(await coverage(`?target=bank&accountId=${coveredId}`)).toEqual({ lastDate: null });
    await importPost(
      csvReq(bank(coveredId), "日付,摘要,金額\n2032-03-01,a,-1\n2032-03-15,b,-1"),
      emptyRouteContext(),
    );
    await createTestEntry(
      tenantId,
      { kind: "BANK", accountId: coveredId },
      { date: new Date("2032-04-01"), description: "手入力", flow: -1 },
    );
    expect(await coverage(`?target=bank&accountId=${coveredId}`)).toEqual({
      lastDate: "2032-03-15",
    });
    await prisma.financialRecord.deleteMany({ where: { bankAccountId: coveredId } });
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
    const res = await importPost(csvReq(bank(), csv), emptyRouteContext());
    expect(res.status).toBe(201);
    expect((await res.json()).result).toMatchObject({ inserted: 1, skipped: 0, locked: 1 });
    expect(
      await prisma.financialRecord.count({
        where: { bankAccountId: bankId, description: "確定済みの月" },
      }),
    ).toBe(0);
  });

  it("誤りのある行があれば、どの行も登録しない", async () => {
    const before = await prisma.financialRecord.count({ where: { bankAccountId: bankId } });
    const csv = ["日付,摘要,金額", "2031-06-01,家賃,-80000", "2031-06-02,,1"].join("\n");
    const res = await importPost(csvReq(bank(), csv), emptyRouteContext());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.result).toBeNull();
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3]);
    expect(await prisma.financialRecord.count({ where: { bankAccountId: bankId } })).toBe(before);
  });

  it("同じ日・同じ摘要・同じ金額の行は別の明細として入り、重なる CSV を入れても二重には入らない", async () => {
    const query = `?target=card&accountId=${cardId}`;
    const first = "日付,摘要,金額\n2031-09-01,コンビニ,-150\n2031-09-01,コンビニ,-150";
    const r1 = await (await importPost(csvReq(query, first), emptyRouteContext())).json();
    expect(r1.result).toMatchObject({ inserted: 2, skipped: 0 });

    // 同じ日の 2 件に、3 件目と次の日の明細が増えた CSV
    const second = `${first}\n2031-09-01,コンビニ,-150\n2031-09-02,コンビニ,-150`;
    const r2 = await (await importPost(csvReq(query, second), emptyRouteContext())).json();
    expect(r2.result).toMatchObject({ inserted: 2, skipped: 2 });
    const count = await prisma.financialRecord.count({
      where: { cardAccountId: cardId, description: "コンビニ" },
    });
    expect(count).toBe(4);
  });

  it("各社の明細の CSV をそろえた形は、そのまま取り込め、2 回目は重複になる", async () => {
    const raw = readFileSync(
      path.resolve(
        __dirname,
        "../../../lib/shared/__fixtures__/statements/card-headerless-sjis.csv",
      ),
    );
    const csv = toImportCsv(convertStatement(decodeCsv(raw))!.rows);
    const query = `?target=card&accountId=${cardId}`;

    const first = await (await importPost(csvReq(query, csv), emptyRouteContext())).json();
    expect(first.result).toMatchObject({ inserted: 3 });
    const rows = await prisma.financialRecord.findMany({
      where: { cardAccountId: cardId, date: { lt: new Date("2027-01-01") } },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => Number(r.flow))).toEqual([-1980, -5400, 1980]);

    const second = await (await importPost(csvReq(query, csv), emptyRouteContext())).json();
    expect(second.result).toMatchObject({ inserted: 0, skipped: 3 });
  });
});
