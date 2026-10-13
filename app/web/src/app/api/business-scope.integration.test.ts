/**
 * 実績の範囲（scope）の結合テスト（実 DB 使用）
 *
 *   - household（家庭・法人モード）は全件・全額。business（個人事業主モード）は、事業利用の明細を按分した額と、
 *     明細でない行（仕訳など）の全額だけを数える（kpi・科目×月・税理士ポータル・決算書・e-Tax）
 *   - 決算書の費用は、明細の全額（total）と事業の分（deductible）を分けて出す。キャッシュは範囲ごとに分かれ、
 *     明細の科目を変えると消える
 *   - 口座・カード・実物資産・借入金は、business では事業利用のものだけを出す
 *   - 事業利用の口座に CSV で取り込んだ明細は、事業利用で入る
 *   - 実績から作る仕訳（個人事業主モードの仕訳帳・総勘定元帳・試算表）の所得は、決算書の所得と一致する
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/server/redis", () => ({
  withCache: vi.fn(async (key: string, _ttl: number, fn: () => unknown) => {
    if (!cache.has(key)) cache.set(key, await fn());
    return cache.get(key);
  }),
  invalidateCache: vi.fn(async (pattern: string) => {
    const re = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    for (const k of [...cache.keys()]) if (re.test(k)) cache.delete(k);
  }),
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
import { createTestEntry } from "@/lib/ledger/test-entries";
import { GET as kpiGet } from "./kpi/route";
import { GET as matrixGet } from "./financials/matrix/route";
import { GET as portalGet } from "./portal/route";
import { GET as statementsGet } from "./closing/statements/route";
import { GET as etaxGet } from "./closing/etax/route";
import { PATCH as bankCategorize } from "./bank-transactions/[id]/categorize/route";
import { GET as bankAccountsGet } from "./bank-accounts/route";
import { GET as linkedAccountsGet } from "./linked-accounts/route";
import { GET as personalAssetsGet } from "./personal-assets/route";
import { GET as loansGet } from "./loans/route";
import { GET as assetsSummaryGet } from "./assets/summary/route";
import { GET as cashOutlookGet } from "./bank-accounts/cash-outlook/route";
import { POST as importsPost } from "./imports/route";
import { GET as trialBalanceGet } from "./reports/trial-balance/route";
import { GET as ledgerGet } from "./reports/general-ledger/route";
import { GET as autoJournalsGet } from "./journals/auto/route";

const SUFFIX = `scope_${Date.now()}`;
const YEAR = 2034;

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body ?? {})),
    headers: new Headers({ "Content-Type": "text/csv", "content-length": "100" }),
  } as unknown as import("next/server").NextRequest;
}
const get = async (handler: typeof kpiGet, url: string) =>
  (await handler(makeReq(`http://x${url}`), emptyRouteContext())).json();

let tenantId: number;
let expense: { id: number; category: "EXPENSE" };
let revenue: { id: number; category: "REVENUE" };
let bizBankId: number;
let homeBankId: number;
let cashEntryId: number;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "financial_records",
    "bank_accounts",
    "linked_accounts",
    "loans",
    "personal_assets",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "範囲",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  expense = {
    id: (
      await prisma.account.create({
        data: { tenantId, code: `E_${SUFFIX}`, name: "通信費", category: "EXPENSE" },
      })
    ).id,
    category: "EXPENSE",
  };
  revenue = {
    id: (
      await prisma.account.create({
        data: { tenantId, code: `R_${SUFFIX}`, name: "売上", category: "REVENUE" },
      })
    ).id,
    category: "REVENUE",
  };
  bizBankId = (
    await prisma.bankAccount.create({
      data: { tenantId, name: "事業口座", bankName: "銀行", businessUse: true },
    })
  ).id;
  homeBankId = (
    await prisma.bankAccount.create({ data: { tenantId, name: "生活口座", bankName: "銀行" } })
  ).id;
  const bizCard = await prisma.linkedAccount.create({
    data: {
      tenantId,
      name: "事業カード",
      type: "CREDIT_CARD",
      institution: "テスト",
      businessUse: true,
    },
  });
  await prisma.linkedAccount.create({
    data: { tenantId, name: "家族カード", type: "CREDIT_CARD", institution: "テスト" },
  });
  for (const businessUse of [true, false]) {
    await prisma.personalAsset.create({
      data: {
        tenantId,
        name: businessUse ? "事業用車" : "自宅",
        currentValue: 1_000_000,
        businessUse,
      },
    });
    await prisma.loan.create({
      data: {
        tenantId,
        lenderName: businessUse ? "事業ローン" : "住宅ローン",
        amount: 1_000_000,
        interestRate: 0,
        borrowedOn: new Date(2030, 0, 1),
        repaymentDate: new Date(2040, 0, 1),
        remainingAmount: 1_000_000,
        businessUse,
      },
    });
  }

  // 3 月の実績: 仕訳の費用 10,000（明細でない行）、現金の費用 3,000 を事業 50%、
  // カードの費用 2,000 は事業利用なし、銀行の売上 50,000 を事業 100%
  const period = await prisma.period.create({
    data: { tenantId, fiscalYear: YEAR, quarter: 1, month: 3 },
  });
  await prisma.financialRecord.create({
    data: { tenantId, periodId: period.id, accountId: expense.id, amount: 10_000 },
  });
  const day = new Date(YEAR, 2, 10);
  cashEntryId = (
    await createTestEntry(
      tenantId,
      { kind: "CASH" },
      {
        date: day,
        description: "携帯電話",
        flow: -3000,
        category: expense,
        business: { businessUse: true, businessRatio: 50 },
      },
    )
  ).id;
  await createTestEntry(
    tenantId,
    { kind: "CARD", accountId: bizCard.id },
    {
      date: day,
      description: "家族の通信",
      flow: -2000,
      category: expense,
    },
  );
  await createTestEntry(
    tenantId,
    { kind: "BANK", accountId: bizBankId },
    {
      date: day,
      description: "売上入金",
      flow: 50_000,
      category: revenue,
      business: { businessUse: true, businessRatio: 100 },
    },
  );
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.financialRecord.deleteMany({ where });
  await prisma.personalAsset.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("実績の集計", () => {
  it("kpi: household は全額、business は事業の分。事業の予算が無ければ予算は null", async () => {
    const home = await get(kpiGet, `/api/kpi?period=${YEAR}-03`);
    const biz = await get(kpiGet, `/api/kpi?period=${YEAR}-03&scope=business`);
    expect(home.kpi).toMatchObject({ revenue: 50_000, operatingProfit: 35_000 });
    expect(biz.kpi).toMatchObject({ revenue: 50_000, operatingProfit: 38_500 });
    expect(biz.budget).toBeNull();
  });

  it("科目×月: business は事業利用の明細と仕訳だけ。amount は事業の分、fullAmount は全額", async () => {
    const biz = await get(matrixGet, `/api/financials/matrix?year=${YEAR}&scope=business`);
    const cash = biz.data.find((r: { id: number }) => r.id === cashEntryId);
    expect(cash).toMatchObject({ amount: 1500, fullAmount: 3000, businessRatio: 50 });
    expect(biz.data).toHaveLength(3); // 仕訳・現金・売上（カードは事業利用なし）
    const home = await get(matrixGet, `/api/financials/matrix?year=${YEAR}`);
    expect(home.data).toHaveLength(4);
  });

  it("税理士ポータル", async () => {
    const biz = await get(portalGet, `/api/portal?fiscalYear=${YEAR}&scope=business`);
    expect(biz.tenants[0]).toMatchObject({ revenue: 50_000, expense: 11_500, netIncome: 38_500 });
  });

  it("決算書: 費用は全額と事業の分を分けて出す。household は按分しない", async () => {
    const biz = await get(statementsGet, `/api/closing/statements?year=${YEAR}&scope=business`);
    expect(biz.pnl).toMatchObject({
      revenueTotal: 50_000,
      expenseTotal: 13_000,
      expenseDeductible: 11_500,
      netIncome: 38_500,
    });
    expect(biz.pnl.expenses[0]).toMatchObject({
      total: 13_000,
      deductible: 11_500,
      businessRate: 88.5,
    });
    const home = await get(statementsGet, `/api/closing/statements?year=${YEAR}`);
    expect(home.pnl).toMatchObject({
      expenseTotal: 15_000,
      expenseDeductible: 15_000,
      netIncome: 35_000,
    });
  });

  it("決算書のキャッシュは、明細の事業利用を変えると消える", async () => {
    // カードの明細を事業利用 100% にすると、事業の費用が 2,000 増える
    const card = await prisma.financialRecord.findFirstOrThrow({
      where: { tenantId, kind: "CARD" },
    });
    const res = await bankCategorize(
      makeReq(`http://x/api/bank-transactions/${card.id}/categorize`, "PATCH", {
        businessUse: true,
        businessRatio: 100,
      }),
      { params: Promise.resolve({ id: String(card.id) }) },
    );
    // カードの明細は銀行の API では見つからない（404）。カードの API で変える
    expect(res.status).toBe(404);
    const { PATCH: cardCategorize } = await import("./card-transactions/[id]/categorize/route");
    const ok = await cardCategorize(
      makeReq(`http://x/api/card-transactions/${card.id}/categorize`, "PATCH", {
        businessUse: true,
        businessRatio: 100,
      }),
      { params: Promise.resolve({ id: String(card.id) }) },
    );
    expect(ok.status).toBe(200);
    const biz = await get(statementsGet, `/api/closing/statements?year=${YEAR}&scope=business`);
    expect(biz.pnl.expenseDeductible).toBe(13_500);
    // 元に戻す
    await prisma.financialRecord.update({
      where: { id: card.id },
      data: { businessUse: false, businessRatio: null },
    });
    cache.clear();
  });

  it("e-Tax: business は事業の分の所得で作る", async () => {
    const xml = async (scope: string) =>
      (
        await etaxGet(
          makeReq(`http://x/api/closing/etax?fiscalYear=${YEAR}&type=blue_return${scope}`),
          emptyRouteContext(),
        )
      ).text();
    expect(await xml("&scope=business")).toContain("38500");
    expect(await xml("")).toContain("35000");
  });
});

describe("実績から作る仕訳", () => {
  it("試算表の所得は決算書（business）と一致し、借方と貸方の合計がそろう", async () => {
    const tb = (
      await get(trialBalanceGet, `/api/reports/trial-balance?year=${YEAR}&scope=business`)
    ).data;
    const st = await get(statementsGet, `/api/closing/statements?year=${YEAR}&scope=business`);
    expect(tb.income).toBe(st.pnl.netIncome);
    expect(tb.income).toBe(38_500);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("仕訳帳: 事業利用の明細・事業用の口座の明細・仕訳の無い実績の行から作る", async () => {
    const res = await get(autoJournalsGet, `/api/journals/auto?year=${YEAR}&month=3`);
    type Line = { side: string; amount: number; account: { name: string; sub: string | null } };
    const summary = (res.data as { description: string; lines: Line[] }[]).map((j) => [
      j.description,
      j.lines.map(
        (l) =>
          `${l.account.name}${l.account.sub ? `（${l.account.sub}）` : ""} ${l.side} ${l.amount}`,
      ),
    ]);
    expect(summary).toEqual([
      ["携帯電話", ["通信費 debit 1500", "事業主借 credit 1500"]],
      ["売上入金", ["売上 credit 50000", "普通預金（事業口座） debit 50000"]],
      // 明細でない行は日付を持たないので、その月の末日
      ["通信費（実績の直接入力）", ["通信費 debit 10000", "事業主借 credit 10000"]],
    ]);
    // 事業利用でないクレジットカードの明細は仕訳にしない
    expect(JSON.stringify(summary)).not.toContain("家族の通信");
  });

  it("総勘定元帳: 普通預金は口座ごと", async () => {
    const res = await get(ledgerGet, `/api/reports/general-ledger?year=${YEAR}&scope=business`);
    const bank = res.data.find(
      (l: { account: { name: string; sub: string | null } }) =>
        l.account.name === "普通預金" && l.account.sub === "事業口座",
    );
    expect(bank).toMatchObject({ totalDebit: 50_000, totalCredit: 0, balance: 50_000 });
  });
});

describe("口座・カード・実物資産・借入金", () => {
  it("business は事業利用のものだけを出す", async () => {
    const names = (rows: { name?: string; lenderName?: string }[]) =>
      rows.map((r) => r.name ?? r.lenderName).sort();
    expect(names((await get(bankAccountsGet, "/api/bank-accounts?scope=business")).data)).toEqual([
      "事業口座",
    ]);
    expect(names((await get(bankAccountsGet, "/api/bank-accounts")).data)).toEqual([
      "事業口座",
      "生活口座",
    ]);
    expect(
      names((await get(linkedAccountsGet, "/api/linked-accounts?scope=business")).data),
    ).toEqual(["事業カード"]);
    expect(
      names((await get(personalAssetsGet, "/api/personal-assets?scope=business")).data),
    ).toEqual(["事業用車"]);
    expect(names((await get(loansGet, "/api/loans?scope=business")).data)).toEqual(["事業ローン"]);
    expect(names((await get(loansGet, "/api/loans")).data)).toHaveLength(2);
  });

  it("総資産サマリと資金繰りも、business は事業利用のものだけ", async () => {
    const amountOf = (summary: { breakdown: { key: string; amount: number }[] }, key: string) =>
      summary.breakdown.find((b) => b.key === key)?.amount;
    const biz = await get(
      assetsSummaryGet,
      `/api/assets/summary?year=${YEAR}&month=3&scope=business`,
    );
    const home = await get(assetsSummaryGet, `/api/assets/summary?year=${YEAR}&month=3`);
    // 借入金は同じ条件の 2 本のうち、事業利用の 1 本だけ（残高は返済予定どおりに減る）
    expect(amountOf(biz, "loans")).toBeGreaterThan(0);
    expect(amountOf(home, "loans")).toBe(2 * amountOf(biz, "loans")!);
    const outlook = await get(cashOutlookGet, "/api/bank-accounts/cash-outlook?scope=business");
    expect(outlook.accounts.map((a: { id: number }) => a.id)).toEqual([bizBankId]);
    expect(outlook.accounts.map((a: { id: number }) => a.id)).not.toContain(homeBankId);
  });

  it("事業利用の口座に CSV で取り込んだ明細は事業利用で入る。そうでない口座は事業利用なし", async () => {
    const csv = (desc: string) => ["日付,摘要,金額", `${YEAR}-04-01,${desc},-1000`].join("\n");
    for (const [accountId, desc] of [
      [bizBankId, "事業口座の支払い"],
      [homeBankId, "生活口座の支払い"],
    ] as const) {
      const res = await importsPost(
        makeReq(`http://x/api/imports?target=bank&accountId=${accountId}`, "POST", csv(desc)),
        emptyRouteContext(),
      );
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
      expect((await res.json()).results[0].inserted).toBe(1);
    }
    const rows = await prisma.financialRecord.findMany({
      where: { tenantId, description: { endsWith: "口座の支払い" } },
      orderBy: { description: "asc" },
    });
    expect(
      rows.map((r) => [r.description, r.businessUse, r.businessRatio && Number(r.businessRatio)]),
    ).toEqual([
      ["事業口座の支払い", true, 100],
      ["生活口座の支払い", false, null],
    ]);
  });
});
