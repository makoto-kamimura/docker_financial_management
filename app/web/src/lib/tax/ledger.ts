// 控除・確定申告のページの下書きに使う、帳簿の年合計（TaxLedger）を集める。
// 家庭モードの科目コードで年合計を出す（科目は lib/accounting/default-accounts.ts）。個人の税金の話なので
// 個人事業主モードでも全額で数え、事業所得だけは事業の分（scope=business）の P/L から出す。
// 確定申告の見込みは予定を含めるので、入力月（ページを開いた月）より前は実績、入力月以降は予算で数える
// （資金繰りの見込み lib/ledger/cash-outlook.ts と同じ考え方）。過去の年はすべて実績、来年以降はすべて予算。
import type { LedgerAmountKey, LedgerPlan, TaxLedger } from "@/lib/shared/tax-estimate";
import { actualRows } from "@/lib/ledger/actuals";
import { actualWhere, scopedAmount, SCOPE_SELECT } from "@/lib/ledger/scope";
import { loanBalanceAt, LOAN_INCLUDE } from "@/lib/assets/loan-balance";
import type { TenantDbClient } from "@/lib/server/tenant-db";

/** 下書きに使う科目。通勤手当（H-1017）は非課税なので給与に入れない */
export const TAX_LEDGER_CODES = {
  salary: ["H-1001", "H-1002", "H-1018", "H-1019"],
  // 給与の振込額は通勤手当を含む（給与明細の手取りの下書き）
  salaryDeposit: ["H-1001", "H-1002", "H-1017", "H-1018", "H-1019"],
  socialInsurance: ["H-3009", "H-3035", "H-3036", "H-3037", "H-3038"],
  withheldTax: ["H-3030"],
  lifeGeneral: ["H-3027", "H-3029"],
  lifeCare: ["H-3010"],
  // 医療費控除は医療費＋医薬品費（治療のための市販薬は対象）。セルフメディケーション税制の下書きは医薬品費。
  // どちらか一方しか使えないので、控除額の大きい方を選ぶ（lib/shared/tax-estimate.ts）
  medical: ["H-2005", "H-2006"],
  selfMedication: ["H-2006"],
  furusato: ["H-3039"],
  sideIncome: ["H-1008"],
  // 「その他の所得」の参考（収入の額。所得は経費・控除を引いて手で入れる）
  pensionIncome: ["H-1009"],
  realEstateIncome: ["H-1006"],
  householdBusinessIncome: ["H-1007"],
  cryptoIncome: ["H-1014"],
  fireEarthquake: ["H-3028"],
  otherDonation: ["H-3033"],
  // 保険の割戻金。生命保険料控除は「払った保険料 − 割戻金」なので一般生命保険料から引く
  insuranceRefund: ["H-1012"],
} as const satisfies Partial<Record<LedgerAmountKey, readonly string[]>>;

/** 青色申告特別控除（e-Tax などの要件を満たす場合の 65 万円） */
export const BLUE_RETURN_DEDUCTION = 650_000;

/** 月ごとの額（添字 1〜12。0 は使わない） */
type Months = number[];
const emptyMonths = (): Months => Array.from({ length: 13 }, () => 0);

/** 予定（予算）として数え始める月。過去の年は null（すべて実績）、来年以降は 1（すべて予算） */
export function planFromMonth(year: number, now: Date): number | null {
  const thisYear = now.getFullYear();
  if (year < thisYear) return null;
  if (year > thisYear) return 1;
  return now.getMonth() + 1;
}

export function ledgerPlan(year: number, now: Date): LedgerPlan {
  const fromMonth = planFromMonth(year, now);
  return {
    fromMonth,
    status: fromMonth === null ? "actual" : fromMonth === 1 ? "plan" : "mixed",
  };
}

/**
 * 1 つの科目の月ごとの実績と予算を合わせる。入力月より前は実績、入力月以降は実績と予算の大きい方
 * （今月すでに入った給与や、予算の無い突発の支出を落とさないため）。planned は入力月以降の分。
 */
export function mergePlanned(
  actual: Months,
  budget: Months,
  fromMonth: number | null,
): { total: number; planned: number } {
  let total = 0;
  let planned = 0;
  for (let m = 1; m <= 12; m++) {
    const a = actual[m] ?? 0;
    if (fromMonth === null || m < fromMonth) {
      total += a;
    } else {
      const v = Math.max(a, budget[m] ?? 0);
      total += v;
      planned += v;
    }
  }
  return { total, planned };
}

/** 科目（キー）ごとに月の実績・予算をためる */
class MonthlyBook {
  private actual = new Map<string, Months>();
  private budget = new Map<string, Months>();
  private months(map: Map<string, Months>, key: string) {
    let m = map.get(key);
    if (!m) map.set(key, (m = emptyMonths()));
    return m;
  }
  addActual(key: string, month: number, amount: number) {
    this.months(this.actual, key)[month] += amount;
  }
  addBudget(key: string, month: number, amount: number) {
    this.months(this.budget, key)[month] += amount;
  }
  keys() {
    return new Set([...this.actual.keys(), ...this.budget.keys()]);
  }
  merge(key: string, fromMonth: number | null) {
    return mergePlanned(
      this.actual.get(key) ?? emptyMonths(),
      this.budget.get(key) ?? emptyMonths(),
      fromMonth,
    );
  }
}

export async function loadTaxLedger(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  opts: { sole: boolean; now?: Date },
): Promise<TaxLedger> {
  const plan = ledgerPlan(year, opts.now ?? new Date());
  const codes = [...new Set(Object.values(TAX_LEDGER_CODES).flat())];
  const [records, budgets] = await Promise.all([
    db.financialRecord.findMany({
      where: {
        tenantId,
        ...actualWhere("household"),
        period: { fiscalYear: year },
        account: { code: { in: codes } },
      },
      select: {
        amount: true,
        accountId: true,
        account: { select: { code: true } },
        period: { select: { month: true } },
      },
    }),
    plan.fromMonth === null
      ? Promise.resolve([])
      : db.budget.findMany({
          where: {
            tenantId,
            scope: "HOUSEHOLD",
            period: { fiscalYear: year },
            account: { code: { in: codes } },
          },
          select: {
            amount: true,
            account: { select: { code: true } },
            period: { select: { month: true } },
          },
        }),
  ]);
  const book = new MonthlyBook();
  for (const r of actualRows(records))
    book.addActual(r.account.code, r.period.month, Number(r.amount));
  for (const b of budgets) book.addBudget(b.account.code, b.period.month, Number(b.amount));

  const planned: TaxLedger["planned"] = {};
  const sum = (key: keyof typeof TAX_LEDGER_CODES) => {
    let total = 0;
    let part = 0;
    for (const code of TAX_LEDGER_CODES[key]) {
      const m = book.merge(code, plan.fromMonth);
      total += m.total;
      part += m.planned;
    }
    return { total: Math.round(total), planned: Math.round(part) };
  };
  const total = (key: keyof typeof TAX_LEDGER_CODES) => {
    const v = sum(key);
    if (v.planned !== 0) planned[key] = v.planned;
    return v.total;
  };

  // 一般生命保険料は割戻金を引いた額（0 未満は 0）。予定の分も同じく引く
  const premium = sum("lifeGeneral");
  const refund = sum("insuranceRefund");
  const lifeGeneral = Math.max(0, premium.total - refund.total);
  const lifePlanned = Math.min(lifeGeneral, Math.max(0, premium.planned - refund.planned));
  if (lifePlanned !== 0) planned.lifeGeneral = lifePlanned;
  if (refund.planned !== 0) planned.insuranceRefund = refund.planned;

  const [business, blueReturn, housingBalance] = await Promise.all([
    opts.sole ? loadBusinessIncome(db, tenantId, year, plan.fromMonth) : Promise.resolve(null),
    opts.sole
      ? db.businessProfile.findUnique({ where: { tenantId }, select: { blueReturn: true } })
      : Promise.resolve(null),
    loadHousingBalance(db, tenantId, year),
  ]);
  if (business && business.planned !== 0) planned.businessIncome = business.planned;

  return {
    salary: total("salary"),
    salaryDeposit: total("salaryDeposit"),
    socialInsurance: total("socialInsurance"),
    withheldTax: total("withheldTax"),
    lifeGeneral,
    lifeCare: total("lifeCare"),
    medical: total("medical"),
    selfMedication: total("selfMedication"),
    furusato: total("furusato"),
    businessIncome: business?.total ?? null,
    blueReturnDeduction: opts.sole ? (blueReturn?.blueReturn ? BLUE_RETURN_DEDUCTION : 0) : null,
    housingBalance,
    sideIncome: total("sideIncome"),
    pensionIncome: total("pensionIncome"),
    realEstateIncome: total("realEstateIncome"),
    householdBusinessIncome: total("householdBusinessIncome"),
    cryptoIncome: total("cryptoIncome"),
    fireEarthquake: total("fireEarthquake"),
    otherDonation: total("otherDonation"),
    insuranceRefund: refund.total,
    plan,
    planned,
  };
}

/**
 * 事業の利益（収入 − 原価 − 経費の事業の分）。決算書（closing/statements）と同じ集計に、
 * 入力月以降は事業の予算（scope=BUSINESS）を合わせる
 */
async function loadBusinessIncome(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  fromMonth: number | null,
) {
  const [records, budgets] = await Promise.all([
    db.financialRecord.findMany({
      where: { tenantId, ...actualWhere("business"), period: { fiscalYear: year } },
      select: {
        amount: true,
        accountId: true,
        ...SCOPE_SELECT,
        account: { select: { category: true } },
        period: { select: { month: true } },
      },
    }),
    fromMonth === null
      ? Promise.resolve([])
      : db.budget.findMany({
          where: { tenantId, scope: "BUSINESS", period: { fiscalYear: year } },
          select: {
            amount: true,
            accountId: true,
            account: { select: { category: true } },
            period: { select: { month: true } },
          },
        }),
  ]);
  const sign = (category: string) =>
    category === "REVENUE" ? 1 : category === "COGS" || category === "EXPENSE" ? -1 : 0;
  const book = new MonthlyBook();
  const signs = new Map<string, number>();
  for (const r of actualRows(records)) {
    const key = String(r.accountId);
    signs.set(key, sign(r.account.category));
    book.addActual(key, r.period.month, scopedAmount(r, "business"));
  }
  for (const b of budgets) {
    const key = String(b.accountId);
    signs.set(key, sign(b.account.category));
    book.addBudget(key, b.period.month, Number(b.amount));
  }
  let total = 0;
  let planned = 0;
  for (const key of book.keys()) {
    const s = signs.get(key) ?? 0;
    if (s === 0) continue;
    const m = book.merge(key, fromMonth);
    total += s * m.total;
    planned += s * m.planned;
  }
  return { total: Math.round(total), planned: Math.round(planned) };
}

/** 住宅ローンの 12/31 時点の残高の合計。住宅ローンが無ければ null */
async function loadHousingBalance(db: TenantDbClient, tenantId: number, year: number) {
  const loans = await db.loan.findMany({
    where: { tenantId, loanType: "housing" },
    include: { repayments: LOAN_INCLUDE.repayments },
  });
  if (loans.length === 0) return null;
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  return loans.reduce((s, l) => s + loanBalanceAt(l, yearEnd), 0);
}
