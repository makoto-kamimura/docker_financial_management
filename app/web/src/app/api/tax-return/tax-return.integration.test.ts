/**
 * 控除・確定申告と、所得税・住民税の控除額の設定の結合テスト（実 DB 使用）
 *
 *   - 帳簿の年合計を科目コードで下書きにする（通勤手当 H-1017 は給与に入れない）
 *   - 保存した入力（上書き）が帳簿の値より優先される
 *   - 給与明細を使うと、帳簿の振込額（手取り）から額面・社会保険料・源泉所得税を出す。給与明細の無い古い入力も読める
 *   - 個人事業主モード（scope=business）は事業の分の利益から事業所得を出し、青色申告なら 65 万円を引く
 *   - 住宅ローンの 12/31 時点の残高を下書きにする
 *   - 設定の上書きが見込みの計算に効き、前年からのコピー・既定値に戻すができる
 *   - 今年は入力月（今日の月）より前を実績、入力月以降を予算で数える（過去の年は実績だけ）
 *   - 保険割戻金を一般生命保険料から引く
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
import { emptyPayroll, emptyTaxInputs } from "@/lib/shared/tax-estimate";
import { GET as taxReturnGet, PUT as taxReturnPut } from "./route";
import { GET as rulesGet, PUT as rulesPut, DELETE as rulesDelete } from "../tax-rules/route";
import { POST as rulesCopy } from "../tax-rules/copy/route";

const SUFFIX = `taxret_${Date.now()}`;
// 既定値のある年（2026）を使う。テナントごとに分かれるので他のテストと混ざらない
const YEAR = 2026;

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (handler: any, url: string, method = "GET", body?: unknown) => {
  const res: Response = await handler(makeReq(`http://x${url}`, method, body), emptyRouteContext());
  return { status: res.status, json: await res.json() };
};

let tenantId: number;
const accountIds = new Map<string, { id: number; category: "REVENUE" | "EXPENSE" | "COGS" }>();

// 入力月（今日の月）で実績と予定を分けるので、今日を 2026-10-15 に固定する
const TODAY = new Date(2026, 9, 15, 12);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records", "loans"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "控除",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  const accounts = [
    ["H-1001", "給与", "REVENUE"],
    ["H-1017", "通勤手当", "REVENUE"],
    ["H-3009", "社会保険", "EXPENSE"],
    ["H-3030", "所得税", "EXPENSE"],
    ["H-2005", "医療費", "COGS"],
    ["H-3039", "ふるさと納税", "EXPENSE"],
    [`S_${SUFFIX}`, "売上", "REVENUE"],
    [`E_${SUFFIX}`, "経費", "EXPENSE"],
  ] as const;
  for (const [code, name, category] of accounts) {
    const a = await prisma.account.create({ data: { tenantId, code, name, category } });
    accountIds.set(code, { id: a.id, category });
  }
  // 個人の分は事業利用でない現金の明細で入れる（個人事業主モードの事業所得に混ざらない）
  const personal = (code: string, flow: number) =>
    createTestEntry(
      tenantId,
      { kind: "CASH" },
      { date: new Date(YEAR, 5, 1), description: code, flow, category: accountIds.get(code)! },
    );
  await personal("H-1001", 5_000_000);
  await personal("H-1017", 120_000);
  await personal("H-3009", -750_000);
  await personal("H-3030", -100_000);
  await personal("H-2005", -150_000);
  await personal("H-3039", -30_000);
  // 事業: 売上 3,000,000（明細でない行は全額が事業）、経費 1,000,000 のうち事業 50%
  const period = await prisma.period.findFirstOrThrow({
    where: { tenantId, fiscalYear: YEAR, month: 6 },
  });
  await prisma.financialRecord.create({
    data: {
      tenantId,
      periodId: period.id,
      accountId: accountIds.get(`S_${SUFFIX}`)!.id,
      amount: 3_000_000,
    },
  });
  await createTestEntry(
    tenantId,
    { kind: "CASH" },
    {
      date: new Date(YEAR, 5, 10),
      description: "通信",
      flow: -1_000_000,
      category: accountIds.get(`E_${SUFFIX}`)!,
      business: { businessUse: true, businessRatio: 50 },
    },
  );
  await prisma.businessProfile.create({ data: { tenantId, blueReturn: true } });
  await prisma.loan.create({
    data: {
      tenantId,
      lenderName: "住宅ローン",
      loanType: "housing",
      amount: 30_000_000,
      interestRate: 0,
      borrowedOn: new Date(Date.UTC(YEAR, 0, 1)),
      repaymentDate: new Date(Date.UTC(YEAR + 24, 11, 1)),
      remainingAmount: 30_000_000,
    },
  });
});

afterAll(async () => {
  vi.useRealTimers();
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.budget.deleteMany({ where });
  await prisma.taxReturnInput.deleteMany({ where });
  await prisma.taxRuleOverride.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
  await prisma.businessProfile.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("GET /api/tax-return", () => {
  it("帳簿の年合計を下書きにする（通勤手当は給与に入れない）", async () => {
    const { status, json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    expect(status).toBe(200);
    const { ledger, estimate, rulesInfo } = json.data;
    expect(ledger).toMatchObject({
      salary: 5_000_000,
      salaryDeposit: 5_120_000,
      socialInsurance: 750_000,
      withheldTax: 100_000,
      medical: 150_000,
      furusato: 30_000,
      businessIncome: null,
      blueReturnDeduction: null,
    });
    expect(rulesInfo.fallback).toBe(false);
    expect(estimate.income.salaryIncome).toBe(3_560_000);
    expect(estimate.furusato.donated).toBe(30_000);
    // 医療費 150,000 − 100,000 = 50,000 の医療費控除で、確定申告すると戻る
    expect(estimate.medicalChoice.medical).toBe(50_000);
    expect(estimate.filing.willFile).toBe(true);
  });

  it("住宅ローンの 12/31 時点の残高を下書きにする", async () => {
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    // 無利子・300 回払いで 12 回返済した残り
    expect(json.data.ledger.housingBalance).toBe(30_000_000 - 100_000 * 12);
  });

  it("個人事業主モードは事業の分の利益から事業所得を出し、青色申告なら 65 万円を引く", async () => {
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}&scope=business`);
    expect(json.data.ledger.businessIncome).toBe(3_000_000 - 500_000);
    expect(json.data.ledger.blueReturnDeduction).toBe(650_000);
    expect(json.data.estimate.income.business).toBe(2_500_000 - 650_000);
  });
});

describe("PUT /api/tax-return", () => {
  it("保存した上書きが帳簿の値より優先される", async () => {
    const inputs = { ...emptyTaxInputs(YEAR), salary: 6_000_000, furusatoMunicipalities: 2 };
    const put = await call(taxReturnPut, "/api/tax-return", "PUT", { year: YEAR, inputs });
    expect(put.status).toBe(200);
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    expect(json.data.inputs.salary).toBe(6_000_000);
    expect(json.data.estimate.values.salary).toEqual({
      value: 6_000_000,
      source: "input",
      ledger: 5_000_000,
    });
  });

  it("給与明細を使うと、振込額を手取りとして額面・社会保険料・源泉所得税を出す", async () => {
    const item = (monthly: number) => ({ monthly, months: 12, bonus: 0, annual: null });
    const payroll = {
      ...emptyPayroll(YEAR),
      enabled: true,
      commute: item(10_000),
      health: item(20_000),
      pension: item(36_600),
      employment: item(2_400),
      incomeTax: item(10_000),
      residentTax: { ...item(0), annual: 200_000 },
    };
    const put = await call(taxReturnPut, "/api/tax-return", "PUT", {
      year: YEAR,
      inputs: { ...emptyTaxInputs(YEAR), payroll },
    });
    expect(put.status).toBe(200);
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    const e = json.data.estimate;
    expect(json.data.inputs.payroll.residentTax.annual).toBe(200_000);
    // 天引き 社会保険 708,000 ＋ 所得税 120,000 ＋ 住民税 200,000
    expect(e.payroll.gross).toBe(5_120_000 + 1_028_000);
    expect(e.income.salary).toBe(5_120_000 + 1_028_000 - 120_000);
    expect(e.values.socialInsurance).toEqual({
      value: 708_000,
      source: "payroll",
      ledger: 750_000,
    });
    expect(e.refund.withheld).toBe(120_000);
  });

  it("給与明細の無い古い入力も初期値で埋めて読める", async () => {
    const { payroll, ...old } = emptyTaxInputs(YEAR);
    expect(payroll.enabled).toBe(false);
    await prisma.taxReturnInput.update({
      where: { tenantId_taxYear: { tenantId, taxYear: YEAR } },
      data: { inputs: { ...old, salary: 6_000_000 } },
    });
    const { status, json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    expect(status).toBe(200);
    expect(json.data.inputs.salary).toBe(6_000_000);
    expect(json.data.inputs.payroll).toEqual(emptyPayroll(YEAR));
    expect(json.data.estimate.payroll).toBeNull();
  });

  it("形の合わない入力は 400", async () => {
    const bad = { ...emptyTaxInputs(YEAR), salary: -1 };
    const { status } = await call(taxReturnPut, "/api/tax-return", "PUT", {
      year: YEAR,
      inputs: bad,
    });
    expect(status).toBe(400);
  });
});

describe("/api/tax-rules", () => {
  it("上書きが控除・確定申告の計算に効く", async () => {
    const before = (await call(taxReturnGet, `/api/tax-return?year=${YEAR}`)).json.data.estimate;
    const put = await call(rulesPut, "/api/tax-rules", "PUT", {
      year: YEAR,
      values: { "resident.perCapita": 6_000, "resident.rate": 0.1 },
    });
    expect(put.status).toBe(200);
    // 既定値と同じ項目は保存しない
    expect(put.json.data.override).toEqual({ "resident.perCapita": 6_000 });
    expect(put.json.data.changed).toEqual(["resident.perCapita"]);
    const after = (await call(taxReturnGet, `/api/tax-return?year=${YEAR}`)).json.data;
    expect(after.rulesInfo.changed).toEqual(["resident.perCapita"]);
    expect(after.estimate.resident.perCapita).toBe(6_000);
    expect(after.estimate.resident.total).toBe(before.resident.total + 1_000);
  });

  it("検証に通らない値は 400", async () => {
    const { status } = await call(rulesPut, "/api/tax-rules", "PUT", {
      year: YEAR,
      values: { "resident.rate": 2 },
    });
    expect(status).toBe(400);
  });

  it("既定値のない来年は、前年の値をコピーして作れる", async () => {
    const next = YEAR + 1;
    const before = await call(rulesGet, `/api/tax-rules?year=${next}`);
    expect(before.json.data.fallback).toBe(true);
    const copied = await call(rulesCopy, "/api/tax-rules/copy", "POST", { year: next });
    expect(copied.status).toBe(200);
    expect(copied.json.data.fallback).toBe(false);
    // 前年の上書き（均等割 6,000 円）も引き継ぐ
    expect(copied.json.data.rules.resident.perCapita).toBe(6_000);
    expect(copied.json.data.overrideYears).toEqual([YEAR, next]);
  });

  it("既定値に戻すと上書きが消える", async () => {
    const res = await call(rulesDelete, `/api/tax-rules?year=${YEAR}`, "DELETE");
    expect(res.status).toBe(200);
    expect(res.json.data.override).toEqual({});
    expect(res.json.data.rules.resident.perCapita).toBe(5_000);
  });
});

describe("予定（予算）を含める", () => {
  const budget = async (
    code: string,
    fiscalYear: number,
    month: number,
    amount: number,
    scope: "HOUSEHOLD" | "BUSINESS" = "HOUSEHOLD",
  ) => {
    const period = await prisma.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
      update: {},
      create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
    });
    await prisma.budget.create({
      data: { tenantId, scope, accountId: accountIds.get(code)!.id, periodId: period.id, amount },
    });
  };

  beforeAll(async () => {
    // 給与の予算: 9 月（実績の月なので数えない）と 10〜12 月。前の年（2025）の予算は数えない
    await budget("H-1001", YEAR, 9, 999_999);
    for (const m of [10, 11, 12]) await budget("H-1001", YEAR, m, 400_000);
    await budget("H-1001", YEAR - 1, 11, 400_000);
    // 事業の売上の予算（11 月）
    await budget(`S_${SUFFIX}`, YEAR, 11, 1_000_000, "BUSINESS");
  });

  it("今年は入力月以降を予算で数え、予定の分と予定の扱いを返す", async () => {
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    const { ledger } = json.data;
    expect(ledger.plan).toEqual({ fromMonth: 10, status: "mixed" });
    expect(ledger.salary).toBe(5_000_000 + 1_200_000);
    expect(ledger.salaryDeposit).toBe(5_120_000 + 1_200_000);
    expect(ledger.planned).toMatchObject({ salary: 1_200_000, salaryDeposit: 1_200_000 });
    // 予定の無い科目は planned に入らない
    expect(ledger.planned.medical).toBeUndefined();
  });

  it("過去の年は実績だけ（予算は足さない）", async () => {
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR - 1}`);
    expect(json.data.ledger.plan).toEqual({ fromMonth: null, status: "actual" });
    expect(json.data.ledger.salary).toBe(0);
    expect(json.data.ledger.planned).toEqual({});
  });

  it("個人事業主モードの事業所得にも事業の予算を足す", async () => {
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}&scope=business`);
    expect(json.data.ledger.businessIncome).toBe(2_500_000 + 1_000_000);
    expect(json.data.ledger.planned.businessIncome).toBe(1_000_000);
  });

  it("保険割戻金を一般生命保険料から引く", async () => {
    for (const [code, name, category] of [
      ["H-3027", "生命保険", "EXPENSE"],
      ["H-1012", "保険割戻金", "REVENUE"],
    ] as const) {
      const a = await prisma.account.create({ data: { tenantId, code, name, category } });
      accountIds.set(code, { id: a.id, category });
    }
    for (const month of [1, 2, 3]) {
      await createTestEntry(
        tenantId,
        { kind: "CASH" },
        {
          date: new Date(YEAR, month - 1, 15),
          description: "共済",
          flow: -3_000,
          category: accountIds.get("H-3027")!,
        },
      );
    }
    await createTestEntry(
      tenantId,
      { kind: "CASH" },
      {
        date: new Date(YEAR, 7, 3),
        description: "共済",
        flow: 1_275,
        category: accountIds.get("H-1012")!,
      },
    );
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    expect(json.data.ledger.insuranceRefund).toBe(1_275);
    expect(json.data.ledger.lifeGeneral).toBe(9_000 - 1_275);
  });
});

describe("医薬品費", () => {
  it("医療費控除とセルフメディケーションの両方の下書きになる。以前の保存の 0 は未入力として読む", async () => {
    const a = await prisma.account.create({
      data: { tenantId, code: "H-2006", name: "医薬品費", category: "COGS" },
    });
    await createTestEntry(
      tenantId,
      { kind: "CASH" },
      {
        date: new Date(YEAR, 4, 10),
        description: "ドラッグストア",
        flow: -6_000,
        category: { id: a.id, category: "COGS" },
      },
    );
    await prisma.taxReturnInput.upsert({
      where: { tenantId_taxYear: { tenantId, taxYear: YEAR } },
      update: { inputs: { ...emptyTaxInputs(YEAR), selfMedication: 0 } },
      create: { tenantId, taxYear: YEAR, inputs: { ...emptyTaxInputs(YEAR), selfMedication: 0 } },
    });
    const { json } = await call(taxReturnGet, `/api/tax-return?year=${YEAR}`);
    expect(json.data.ledger.selfMedication).toBe(6_000);
    expect(json.data.ledger.medical).toBe(150_000 + 6_000);
    expect(json.data.inputs.selfMedication).toBeNull();
    expect(json.data.estimate.values.selfMedication).toMatchObject({
      value: 6_000,
      source: "ledger",
    });
  });
});
