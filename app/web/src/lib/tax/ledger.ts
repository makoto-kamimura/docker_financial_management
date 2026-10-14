// 控除・確定申告のページの下書きに使う、帳簿の年合計（TaxLedger）を集める。
// 家庭モードの科目コードで年合計を出す（科目は lib/accounting/default-accounts.ts）。個人の税金の話なので
// 個人事業主モードでも全額で数え、事業所得だけは事業の分（scope=business）の P/L から出す。
import type { TaxLedger } from "@/lib/shared/tax-estimate";
import { actualRows } from "@/lib/ledger/actuals";
import { actualWhere, scopedAmount, SCOPE_SELECT } from "@/lib/ledger/scope";
import { loanBalanceAt, LOAN_INCLUDE } from "@/lib/assets/loan-balance";
import type { TenantDbClient } from "@/lib/server/tenant-db";

/** 下書きに使う科目。通勤手当（H-1017）は非課税なので給与に入れない */
export const TAX_LEDGER_CODES = {
  salary: ["H-1001", "H-1002", "H-1018", "H-1019"],
  socialInsurance: ["H-3009", "H-3035", "H-3036", "H-3037", "H-3038"],
  withheldTax: ["H-3030"],
  lifeGeneral: ["H-3027", "H-3029"],
  lifeCare: ["H-3010"],
  medical: ["H-2005", "H-2006"],
  furusato: ["H-3039"],
  sideIncome: ["H-1008"],
  fireEarthquake: ["H-3028"],
  otherDonation: ["H-3033"],
} as const satisfies Partial<Record<keyof TaxLedger, readonly string[]>>;

/** 青色申告特別控除（e-Tax などの要件を満たす場合の 65 万円） */
export const BLUE_RETURN_DEDUCTION = 650_000;

export async function loadTaxLedger(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  opts: { sole: boolean },
): Promise<TaxLedger> {
  const codes = Object.values(TAX_LEDGER_CODES).flat();
  const rows = actualRows(
    await db.financialRecord.findMany({
      where: {
        tenantId,
        ...actualWhere("household"),
        period: { fiscalYear: year },
        account: { code: { in: codes } },
      },
      select: { amount: true, accountId: true, account: { select: { code: true } } },
    }),
  );
  const byCode = new Map<string, number>();
  for (const r of rows)
    byCode.set(r.account.code, (byCode.get(r.account.code) ?? 0) + Number(r.amount));
  const total = (key: keyof typeof TAX_LEDGER_CODES) =>
    Math.round(TAX_LEDGER_CODES[key].reduce((s, c) => s + (byCode.get(c) ?? 0), 0));

  const [businessIncome, blueReturn, housingBalance] = await Promise.all([
    opts.sole ? loadBusinessIncome(db, tenantId, year) : Promise.resolve(null),
    opts.sole
      ? db.businessProfile.findUnique({ where: { tenantId }, select: { blueReturn: true } })
      : Promise.resolve(null),
    loadHousingBalance(db, tenantId, year),
  ]);

  return {
    salary: total("salary"),
    socialInsurance: total("socialInsurance"),
    withheldTax: total("withheldTax"),
    lifeGeneral: total("lifeGeneral"),
    lifeCare: total("lifeCare"),
    medical: total("medical"),
    furusato: total("furusato"),
    businessIncome,
    blueReturnDeduction: opts.sole ? (blueReturn?.blueReturn ? BLUE_RETURN_DEDUCTION : 0) : null,
    housingBalance,
    sideIncome: total("sideIncome"),
    fireEarthquake: total("fireEarthquake"),
    otherDonation: total("otherDonation"),
  };
}

/** 事業の利益（収入 − 原価 − 経費の事業の分）。決算書（closing/statements）と同じ集計 */
async function loadBusinessIncome(db: TenantDbClient, tenantId: number, year: number) {
  const rows = actualRows(
    await db.financialRecord.findMany({
      where: { tenantId, ...actualWhere("business"), period: { fiscalYear: year } },
      select: {
        amount: true,
        accountId: true,
        ...SCOPE_SELECT,
        account: { select: { category: true } },
      },
    }),
  );
  let profit = 0;
  for (const r of rows) {
    const amount = scopedAmount(r, "business");
    if (r.account.category === "REVENUE") profit += amount;
    else if (r.account.category === "COGS" || r.account.category === "EXPENSE") profit -= amount;
  }
  return Math.round(profit);
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
