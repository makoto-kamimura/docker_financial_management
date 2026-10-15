// 控除・確定申告の概算。帳簿の年合計（TaxLedger）と手入力（TaxInputs）から、所得控除・所得税・住民税・
// ふるさと納税の上限・確定申告の要否・必要な書類を出す。あくまで目安で、住民税は自治体ごとの差を見ない。
// Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。
import { amountFor, findRow, rateFor, type HousingRow, type TaxRules } from "./tax-rules";
import {
  ageAt,
  isHousingSpecialHousehold,
  judgeFamily,
  salaryIncome,
  type Disability,
  type FamilyMember,
  type FamilySummary,
} from "./tax-family";

export type HousingLoanInput = {
  enabled: boolean;
  movedInYear: number;
  build: "new" | "used";
  energy: "certified" | "zeh" | "energy" | "other";
  /** 年末残高。null なら帳簿の住宅ローンの残高を使う */
  balance: number | null;
  /** 入居した年の分（確定申告が要る） */
  firstYear: boolean;
  /** 床面積 40〜50㎡ */
  smallFloor: boolean;
  /** 控除額を直接入れる（令和3年以前の入居など、表で出せない場合）。null なら表から出す */
  creditOverride: number | null;
};

/** 給与明細の 1 項目。年合計は annual、null なら「月額 × 月数 ＋ 賞与」 */
export type PayrollItem = { monthly: number; months: number; bonus: number; annual: number | null };

export const PAYROLL_ITEM_KEYS = [
  "gross",
  "commute",
  "health",
  "care",
  "childSupport",
  "pension",
  "employment",
  "incomeTax",
  "residentTax",
  "other",
] as const;

export type PayrollItemKey = (typeof PAYROLL_ITEM_KEYS)[number];

/** 社会保険料控除になる天引き */
export const PAYROLL_SOCIAL_KEYS = [
  "health",
  "care",
  "childSupport",
  "pension",
  "employment",
] as const satisfies readonly PayrollItemKey[];

/**
 * 給与明細（会社員の天引き）。口座には手取りしか入らないので、額面・社会保険料・源泉所得税はここから出す。
 * gross（総支給）と commute（通勤手当）は収入の側、それ以外は天引きの側。
 */
export type PayrollInput = Record<PayrollItemKey, PayrollItem> & {
  enabled: boolean;
  /** 帳簿の給与（振込額）が手取りか額面か */
  ledgerSalaryIs: "takeHome" | "gross";
  /** 手取りの年合計。null なら帳簿の振込額 */
  takeHome: number | null;
  /** 国民年金・家族の分など、天引き以外で払った社会保険料 */
  otherSocialInsurance: number;
};

export type TaxInputs = {
  selfBirthDate: string | null;
  selfDisability: Disability;
  selfStatus: "none" | "widow" | "singleParent";
  workingStudent: boolean;
  /** 勤め先で年末調整を受けた（受ける） */
  yearEndAdjusted: boolean;
  family: FamilyMember[];
  // 帳簿の値の上書き（null なら帳簿の値）
  salary: number | null;
  socialInsurance: number | null;
  withheldTax: number | null;
  businessIncome: number | null;
  blueReturnDeduction: number | null;
  lifeGeneralNew: number | null;
  lifeCare: number | null;
  medicalPaid: number | null;
  furusato: number | null;
  // 手入力だけの値
  otherIncome: number;
  smallBusinessMutualAid: number;
  lifeGeneralOld: number;
  lifePensionNew: number;
  lifePensionOld: number;
  earthquake: number;
  medicalReimbursed: number;
  selfMedication: number;
  /** 健康診断・予防接種などを受けている（セルフメディケーション税制の条件） */
  selfMedicationEligible: boolean;
  casualtyLoss: number;
  casualtyReimbursed: number;
  casualtyDisaster: number;
  housingLoan: HousingLoanInput;
  otherTaxCredit: number;
  furusatoMunicipalities: number;
  otherDonation: number;
  payroll: PayrollInput;
  /** やること・書類のチェック（id） */
  checks: string[];
};

/** 帳簿から出した年合計（API が科目コードで集計する） */
export type TaxLedger = {
  salary: number;
  /** 給与の振込額（通勤手当を含む）。給与明細の手取りの下書き */
  salaryDeposit: number;
  socialInsurance: number;
  withheldTax: number;
  lifeGeneral: number;
  lifeCare: number;
  medical: number;
  furusato: number;
  /** 個人事業主モードの事業の利益（青色申告特別控除の前）。家計モードでは null */
  businessIncome: number | null;
  /** 青色申告なら 65 万円、そうでなければ 0。家計モードでは null */
  blueReturnDeduction: number | null;
  /** 住宅ローンの年末残高の見込み。住宅ローンが無ければ null */
  housingBalance: number | null;
  // 参考に見せるだけの値
  sideIncome: number;
  fireEarthquake: number;
  otherDonation: number;
  /** 保険の割戻金（一般生命保険料から引いた額） */
  insuranceRefund: number;
  /** どの月から予定（予算）で数えたか */
  plan: LedgerPlan;
  /** 各値のうち予定（入力月以降の予算）の分。0 の項目は持たない */
  planned: Partial<Record<LedgerAmountKey, number>>;
};

/** 帳簿の値のうち、実績と予定に分けられる金額の項目 */
export type LedgerAmountKey =
  | "salary"
  | "salaryDeposit"
  | "socialInsurance"
  | "withheldTax"
  | "lifeGeneral"
  | "lifeCare"
  | "medical"
  | "furusato"
  | "businessIncome"
  | "sideIncome"
  | "fireEarthquake"
  | "otherDonation"
  | "insuranceRefund";

/**
 * 帳簿の値の予定の扱い。入力月（ページを開いた月）より前は実績、入力月以降は予算で数える。
 * fromMonth は予定として数え始める月（過去の年は null）
 */
export type LedgerPlan = { fromMonth: number | null; status: "actual" | "mixed" | "plan" };

/** 年の合計の呼び方（予定を含むときは「予定年合計」） */
export function yearTotalLabel(plan: LedgerPlan): string {
  return plan.status === "actual" ? "年合計" : "予定年合計";
}

/** 予定を含む値の後ろに付ける言葉 */
export function planSuffix(plan: LedgerPlan): string {
  return plan.status === "actual" ? "" : "（予定）";
}

/** 予定の扱いの説明。すべて実績なら null */
export function planNote(year: number, plan: LedgerPlan): string | null {
  if (plan.fromMonth === null) return null;
  if (plan.fromMonth === 1) {
    return `${year} 年はすべての月を予定（予算管理の予算）として数えています。`;
  }
  return `${year} 年は ${plan.fromMonth} 月以降を予定（予算管理の予算）として数えています。${plan.fromMonth - 1} 月までは実績です。`;
}

/**
 * 実績と予定の内訳の文言（例「実績 300,000円（9 月まで）＋ 予定 100,000円（10〜12 月）」）。
 * 予定の月に予算が無ければ、そのことを書く。すべて実績なら null
 */
export function planBreakdown(
  total: number,
  planned: number | undefined,
  plan: LedgerPlan,
): string | null {
  if (plan.fromMonth === null) return null;
  const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
  const later = plan.fromMonth === 12 ? "12 月" : `${plan.fromMonth}〜12 月`;
  if (!planned) {
    return plan.fromMonth === 1
      ? "予算管理に予算がありません"
      : `${later}の予算が無いため、${plan.fromMonth - 1} 月までの実績だけです`;
  }
  if (plan.fromMonth === 1) return `予定 ${yen(planned)}（${later}）`;
  return `実績 ${yen(total - planned)}（${plan.fromMonth - 1} 月まで）＋ 予定 ${yen(planned)}（${later}）`;
}

export function emptyPayrollItem(): PayrollItem {
  return { monthly: 0, months: 12, bonus: 0, annual: null };
}

/** 子ども・子育て支援金の月数の目安（2026 年 4 月分の保険料＝5 月の給与から天引き） */
export function childSupportMonths(year: number): number {
  return year < 2026 ? 0 : year === 2026 ? 8 : 12;
}

export function emptyPayroll(year: number): PayrollInput {
  const items = Object.fromEntries(PAYROLL_ITEM_KEYS.map((k) => [k, emptyPayrollItem()])) as Record<
    PayrollItemKey,
    PayrollItem
  >;
  items.childSupport.months = childSupportMonths(year);
  return {
    ...items,
    enabled: false,
    ledgerSalaryIs: "takeHome",
    takeHome: null,
    otherSocialInsurance: 0,
  };
}

export function emptyTaxInputs(year: number): TaxInputs {
  return {
    selfBirthDate: null,
    selfDisability: "none",
    selfStatus: "none",
    workingStudent: false,
    yearEndAdjusted: true,
    family: [],
    salary: null,
    socialInsurance: null,
    withheldTax: null,
    businessIncome: null,
    blueReturnDeduction: null,
    lifeGeneralNew: null,
    lifeCare: null,
    medicalPaid: null,
    furusato: null,
    otherIncome: 0,
    smallBusinessMutualAid: 0,
    lifeGeneralOld: 0,
    lifePensionNew: 0,
    lifePensionOld: 0,
    earthquake: 0,
    medicalReimbursed: 0,
    selfMedication: 0,
    selfMedicationEligible: false,
    casualtyLoss: 0,
    casualtyReimbursed: 0,
    casualtyDisaster: 0,
    housingLoan: {
      enabled: false,
      movedInYear: year,
      build: "new",
      energy: "zeh",
      balance: null,
      firstYear: false,
      smallFloor: false,
      creditOverride: null,
    },
    otherTaxCredit: 0,
    furusatoMunicipalities: 0,
    otherDonation: 0,
    payroll: emptyPayroll(year),
    checks: [],
  };
}

/** 給与明細の 1 項目の年合計 */
export function payrollTotal(item: PayrollItem): number {
  if (item.annual !== null) return pos(item.annual);
  return pos(item.monthly) * pos(item.months) + pos(item.bonus);
}

export type PayrollResult = {
  totals: Record<PayrollItemKey, number>;
  /** 社会保険料（天引き分） */
  social: number;
  /** 天引きの合計（社会保険料・所得税・住民税・その他） */
  withheldTotal: number;
  takeHome: ResolvedValue;
  /** 総支給（通勤手当を含む）。入力が無ければ手取りから逆算する */
  gross: number;
  grossSource: "input" | "takeHome" | "ledger";
  /** 課税の給与収入（総支給 − 通勤手当） */
  taxableSalary: number;
  /** 総支給 − 天引き − 手取り。総支給を入れ、手取りもあるときだけ（年末調整の精算などの差） */
  diff: number | null;
};

/** 給与明細の入力から額面・社会保険料・手取りを出す */
export function resolvePayroll(payroll: PayrollInput, ledger: TaxLedger): PayrollResult {
  const totals = Object.fromEntries(
    PAYROLL_ITEM_KEYS.map((k) => [k, payrollTotal(payroll[k])]),
  ) as Record<PayrollItemKey, number>;
  const social = PAYROLL_SOCIAL_KEYS.reduce((s, k) => s + totals[k], 0);
  const withheldTotal = social + totals.incomeTax + totals.residentTax + totals.other;
  const takeHome = resolve(
    payroll.takeHome,
    payroll.ledgerSalaryIs === "takeHome" ? ledger.salaryDeposit : null,
  );
  let gross: number;
  let grossSource: PayrollResult["grossSource"];
  if (totals.gross > 0) {
    gross = totals.gross;
    grossSource = "input";
  } else if (payroll.ledgerSalaryIs === "takeHome") {
    gross = pos(takeHome.value) + withheldTotal;
    grossSource = "takeHome";
  } else {
    // 帳簿の給与は通勤手当を除いた額面
    gross = pos(ledger.salary) + totals.commute;
    grossSource = "ledger";
  }
  const hasTakeHome = takeHome.value > 0;
  return {
    totals,
    social,
    withheldTotal,
    takeHome,
    gross,
    grossSource,
    taxableSalary: pos(gross - totals.commute),
    diff: grossSource === "input" && hasTakeHome ? gross - withheldTotal - takeHome.value : null,
  };
}

export type DeductionKey =
  | "socialInsurance"
  | "smallBusinessMutualAid"
  | "lifeInsurance"
  | "earthquake"
  | "medical"
  | "casualty"
  | "spouse"
  | "dependents"
  | "specifiedRelative"
  | "disability"
  | "widow"
  | "singleParent"
  | "workingStudent"
  | "basic"
  | "donation";

export type DeductionLine = { key: DeductionKey; label: string; income: number; resident: number };

/** 帳簿の値と手入力のどちらを使ったか */
export type ValueSource = "ledger" | "input" | "payroll";

export type ResolvedValue = { value: number; source: ValueSource; ledger: number | null };

export type FilingReason = { key: string; label: string };

export type DocumentItem = { id: string; label: string; why: string };

export type HousingResult = {
  eligible: boolean;
  credit: number;
  limit: number;
  years: number;
  /** 何年目か */
  yearIndex: number;
  special: boolean;
  balance: number;
  reason: string | null;
};

export type TaxEstimate = {
  year: number;
  values: Record<
    | "salary"
    | "socialInsurance"
    | "withheldTax"
    | "businessIncome"
    | "blueReturnDeduction"
    | "lifeGeneralNew"
    | "lifeCare"
    | "medicalPaid"
    | "furusato"
    | "housingBalance",
    ResolvedValue
  >;
  income: { salary: number; salaryIncome: number; business: number; other: number; total: number };
  family: FamilySummary;
  deductions: DeductionLine[];
  deductionTotal: { income: number; resident: number };
  medicalChoice: {
    medical: number;
    selfMedication: number;
    chosen: "medical" | "selfMedication" | "none";
  };
  taxable: { income: number; resident: number };
  incomeTax: {
    rate: number;
    base: number;
    housingCredit: number;
    otherCredit: number;
    surtax: number;
    total: number;
  };
  resident: {
    nonTaxable: boolean;
    levy: number;
    adjust: number;
    housingCredit: number;
    donationCredit: number;
    levyAfter: number;
    perCapita: number;
    total: number;
  };
  housing: HousingResult | null;
  /** 給与明細から出した値。給与明細を使わないときは null */
  payroll:
    | (PayrollResult & {
        /** 今年天引きされた住民税（前年の所得の分）と、この年の所得から出した来年 6 月からの住民税 */
        resident: { withheldThisYear: number; nextYear: number; nextMonthly: number };
      })
    | null;
  furusato: {
    limit: number;
    donated: number;
    remaining: number;
    /** 確定申告で控除を受ける（return）か、ワンストップ特例（oneStop）か */
    path: "return" | "oneStop" | "none";
    oneStopAvailable: boolean;
    warnings: string[];
  };
  refund: { withheld: number; incomeTax: number; amount: number };
  filing: { required: FilingReason[]; beneficial: FilingReason[]; willFile: boolean };
  documents: DocumentItem[];
  notes: string[];
};

const floorTo = (n: number, unit: number) => Math.floor(n / unit) * unit;
const pos = (n: number) => Math.max(0, n);

function resolve(input: number | null, ledger: number | null): ResolvedValue {
  if (input !== null && input !== undefined) return { value: input, source: "input", ledger };
  return { value: ledger ?? 0, source: "ledger", ledger };
}

/** 生命保険料控除の 1 区分（新・旧） */
function lifeCategory(
  newPaid: number,
  oldPaid: number,
  newTable: TaxRules["insurance"]["lifeNewIncome"],
  oldTable: TaxRules["insurance"]["lifeOldIncome"],
  mixedCap: number,
): number {
  const n = newPaid > 0 ? rateFor(newTable, newPaid) : 0;
  const o = oldPaid > 0 ? rateFor(oldTable, oldPaid) : 0;
  if (newPaid > 0 && oldPaid > 0) return Math.max(o, Math.min(n + o, mixedCap));
  return n + o;
}

export function lifeInsuranceDeduction(
  rules: TaxRules,
  paid: {
    generalNew: number;
    generalOld: number;
    care: number;
    pensionNew: number;
    pensionOld: number;
  },
  hasDependentUnder23: boolean,
): { income: number; resident: number } {
  const ins = rules.insurance;
  const young = hasDependentUnder23 && ins.lifeYoungNewIncome.length > 0;
  const income =
    lifeCategory(
      paid.generalNew,
      paid.generalOld,
      young ? ins.lifeYoungNewIncome : ins.lifeNewIncome,
      ins.lifeOldIncome,
      young ? ins.lifeYoungCapIncome : ins.lifeMixedCapIncome,
    ) +
    lifeCategory(paid.care, 0, ins.lifeNewIncome, ins.lifeOldIncome, ins.lifeMixedCapIncome) +
    lifeCategory(
      paid.pensionNew,
      paid.pensionOld,
      ins.lifeNewIncome,
      ins.lifeOldIncome,
      ins.lifeMixedCapIncome,
    );
  const resident =
    lifeCategory(
      paid.generalNew,
      paid.generalOld,
      ins.lifeNewResident,
      ins.lifeOldResident,
      ins.lifeMixedCapResident,
    ) +
    lifeCategory(paid.care, 0, ins.lifeNewResident, ins.lifeOldResident, ins.lifeMixedCapResident) +
    lifeCategory(
      paid.pensionNew,
      paid.pensionOld,
      ins.lifeNewResident,
      ins.lifeOldResident,
      ins.lifeMixedCapResident,
    );
  return {
    income: Math.min(income, ins.lifeTotalCapIncome),
    resident: Math.min(resident, ins.lifeTotalCapResident),
  };
}

/** 所得税（復興特別所得税などの前）と限界税率 */
export function incomeTaxOn(rules: TaxRules, taxable: number): { tax: number; rate: number } {
  if (taxable <= 0) return { tax: 0, rate: 0 };
  const row = findRow(rules.incomeTax.brackets, taxable);
  if (!row) return { tax: 0, rate: 0 };
  return { tax: pos(Math.floor(taxable * row.rate - row.deduct)), rate: row.rate };
}

const HOUSING_KEYS = {
  new: { certified: "newCertified", zeh: "newZeh", energy: "newEnergy", other: "newOther" },
  used: { certified: "usedCertified", zeh: "usedZeh", energy: "usedEnergy", other: "usedOther" },
} as const;

/** 住宅ローン控除（所得税の分。所得税から引ききれない分は住民税から引く） */
export function housingLoanCredit(
  rules: TaxRules,
  year: number,
  input: HousingLoanInput,
  balance: number,
  totalIncome: number,
  special: boolean,
): HousingResult {
  const h = rules.housing;
  const base: HousingResult = {
    eligible: false,
    credit: 0,
    limit: 0,
    years: 0,
    yearIndex: year - input.movedInYear + 1,
    special,
    balance,
    reason: null,
  };
  if (input.creditOverride !== null) {
    return { ...base, eligible: input.creditOverride > 0, credit: pos(input.creditOverride) };
  }
  if (input.movedInYear < 2022) {
    return {
      ...base,
      reason: "令和3年以前の入居は控除率や限度額が違うため、控除額を直接入れてください",
    };
  }
  const incomeLimit = input.smallFloor ? h.smallFloorIncomeLimit : h.incomeLimit;
  if (totalIncome > incomeLimit) {
    return {
      ...base,
      reason: `合計所得が ${incomeLimit.toLocaleString()} 円を超える年は控除を受けられません`,
    };
  }
  const rows: HousingRow[] = h[HOUSING_KEYS[input.build][input.energy]];
  const row = rows.find((r) => r.movedUpTo === null || input.movedInYear <= r.movedUpTo);
  const limit = row ? (special ? row.specialLimit : row.limit) : 0;
  if (!row || limit <= 0) {
    return {
      ...base,
      reason:
        "この入居年・住宅の区分は控除の対象外です（建築確認の時期などの例外は控除額を直接入れてください）",
    };
  }
  if (base.yearIndex > row.years) {
    return {
      ...base,
      limit,
      years: row.years,
      reason: `控除期間（${row.years} 年）が終わっています`,
    };
  }
  if (base.yearIndex < 1) {
    return { ...base, limit, years: row.years, reason: "入居年より前の年です" };
  }
  const credit = floorTo(Math.min(balance, limit) * h.rate, 100);
  return { ...base, eligible: credit > 0, credit, limit, years: row.years };
}

export function estimateTax(
  rules: TaxRules,
  year: number,
  ledger: TaxLedger,
  inputs: TaxInputs,
): TaxEstimate {
  // 給与明細を使うときは、給与・社会保険料・源泉所得税を給与明細から出す（帳簿の値と上書きは使わない）
  const payroll = inputs.payroll.enabled ? resolvePayroll(inputs.payroll, ledger) : null;
  const fromPayroll = (value: number, ledgerValue: number): ResolvedValue => ({
    value,
    source: "payroll",
    ledger: ledgerValue,
  });
  const values: TaxEstimate["values"] = {
    salary: payroll
      ? fromPayroll(payroll.taxableSalary, ledger.salary)
      : resolve(inputs.salary, ledger.salary),
    socialInsurance: payroll
      ? fromPayroll(
          payroll.social + pos(inputs.payroll.otherSocialInsurance),
          ledger.socialInsurance,
        )
      : resolve(inputs.socialInsurance, ledger.socialInsurance),
    withheldTax: payroll
      ? fromPayroll(payroll.totals.incomeTax, ledger.withheldTax)
      : resolve(inputs.withheldTax, ledger.withheldTax),
    businessIncome: resolve(inputs.businessIncome, ledger.businessIncome),
    blueReturnDeduction: resolve(inputs.blueReturnDeduction, ledger.blueReturnDeduction),
    lifeGeneralNew: resolve(inputs.lifeGeneralNew, ledger.lifeGeneral),
    lifeCare: resolve(inputs.lifeCare, ledger.lifeCare),
    medicalPaid: resolve(inputs.medicalPaid, ledger.medical),
    furusato: resolve(inputs.furusato, ledger.furusato),
    housingBalance: resolve(inputs.housingLoan.balance, ledger.housingBalance),
  };
  const notes: string[] = [];

  // ── 所得 ──
  const salary = pos(values.salary.value);
  const salaryInc = salaryIncome(rules, salary);
  // 事業所得は青色申告特別控除を引いた後。控除は利益を超えない
  const businessGross = values.businessIncome.value;
  const blue = Math.min(pos(values.blueReturnDeduction.value), pos(businessGross));
  const business = businessGross - blue;
  const other = pos(inputs.otherIncome);
  const total = pos(salaryInc + business + other);

  const family = judgeFamily(rules, year, inputs.family, total);
  const p = rules.personal;

  // ── 所得控除 ──
  const deductions: DeductionLine[] = [];
  const push = (key: DeductionKey, label: string, income: number, resident: number) => {
    if (income > 0 || resident > 0) deductions.push({ key, label, income, resident });
  };
  const social = pos(values.socialInsurance.value);
  push("socialInsurance", "社会保険料控除", social, social);
  const aid = pos(inputs.smallBusinessMutualAid);
  push("smallBusinessMutualAid", "小規模企業共済等掛金控除（iDeCo など）", aid, aid);
  const life = lifeInsuranceDeduction(
    rules,
    {
      generalNew: pos(values.lifeGeneralNew.value),
      generalOld: pos(inputs.lifeGeneralOld),
      care: pos(values.lifeCare.value),
      pensionNew: pos(inputs.lifePensionNew),
      pensionOld: pos(inputs.lifePensionOld),
    },
    family.hasDependentUnder23,
  );
  push("lifeInsurance", "生命保険料控除", life.income, life.resident);
  const quake = pos(inputs.earthquake);
  push(
    "earthquake",
    "地震保険料控除",
    Math.min(quake, rules.insurance.earthquakeMaxIncome),
    Math.min(
      Math.floor(quake * rules.insurance.earthquakeRateResident),
      rules.insurance.earthquakeMaxResident,
    ),
  );

  // 医療費控除とセルフメディケーション税制はどちらか一方。控除額の大きい方を選ぶ
  const m = rules.medical;
  const medical = Math.min(
    pos(
      pos(values.medicalPaid.value) -
        pos(inputs.medicalReimbursed) -
        Math.min(m.floor, Math.floor(total * m.floorRate)),
    ),
    m.max,
  );
  const selfMed = inputs.selfMedicationEligible
    ? Math.min(pos(pos(inputs.selfMedication) - m.selfMedicationFloor), m.selfMedicationMax)
    : 0;
  const chosen =
    medical === 0 && selfMed === 0 ? "none" : selfMed > medical ? "selfMedication" : "medical";
  const medicalAmount = Math.max(medical, selfMed);
  push(
    "medical",
    chosen === "selfMedication" ? "医療費控除（セルフメディケーション税制）" : "医療費控除",
    medicalAmount,
    medicalAmount,
  );

  const lossNet = pos(pos(inputs.casualtyLoss) - pos(inputs.casualtyReimbursed));
  const casualty = Math.max(
    0,
    lossNet - Math.floor(total * rules.casualty.incomeRate),
    Math.min(pos(inputs.casualtyDisaster), lossNet) - rules.casualty.disasterFloor,
  );
  push("casualty", "雑損控除", casualty, casualty);

  // 人的控除
  const sum = (f: (j: FamilySummary["members"][number]) => number, kinds: string[]) =>
    family.members.filter((j) => kinds.includes(j.kind)).reduce((s, j) => s + f(j), 0);
  push(
    "spouse",
    family.spouse?.kind === "spouseSpecial" ? "配偶者特別控除" : "配偶者控除",
    sum((j) => j.incomeDeduction, ["spouse", "spouseSpecial"]),
    sum((j) => j.residentDeduction, ["spouse", "spouseSpecial"]),
  );
  const depKinds = [
    "dependentGeneral",
    "dependentSpecified",
    "dependentElderly",
    "dependentElderlyLiving",
  ];
  push(
    "dependents",
    "扶養控除",
    sum((j) => j.incomeDeduction, depKinds),
    sum((j) => j.residentDeduction, depKinds),
  );
  push(
    "specifiedRelative",
    "特定親族特別控除",
    sum((j) => j.incomeDeduction, ["specifiedRelative"]),
    sum((j) => j.residentDeduction, ["specifiedRelative"]),
  );
  let selfDisIncome = 0;
  let selfDisResident = 0;
  if (inputs.selfDisability === "general") {
    selfDisIncome = p.disabilityIncome;
    selfDisResident = p.disabilityResident;
  } else if (inputs.selfDisability !== "none") {
    selfDisIncome = p.specialDisabilityIncome;
    selfDisResident = p.specialDisabilityResident;
  }
  push(
    "disability",
    "障害者控除",
    selfDisIncome + family.members.reduce((s, j) => s + j.disabilityIncome, 0),
    selfDisResident + family.members.reduce((s, j) => s + j.disabilityResident, 0),
  );
  const statusOk = total <= p.singleParentIncomeLimit;
  if (inputs.selfStatus === "widow" && statusOk)
    push("widow", "寡婦控除", p.widowIncome, p.widowResident);
  if (inputs.selfStatus === "singleParent" && statusOk) {
    push("singleParent", "ひとり親控除", p.singleParentIncome, p.singleParentResident);
  }
  if (inputs.workingStudent && total <= p.workingStudentIncomeLimit) {
    push("workingStudent", "勤労学生控除", p.workingStudentIncome, p.workingStudentResident);
  }
  const basicIncome = amountFor(rules.basic.income, total);
  const basicResident = amountFor(rules.basic.resident, total);
  push("basic", "基礎控除", basicIncome, basicResident);

  const withoutDonation = {
    income: deductions.reduce((s, d) => s + d.income, 0),
    resident: deductions.reduce((s, d) => s + d.resident, 0),
  };

  // ── 住宅ローン控除の準備 ──
  const housingInput = inputs.housingLoan;
  const special =
    housingInput.enabled &&
    isHousingSpecialHousehold(rules, inputs.selfBirthDate, inputs.family, housingInput.movedInYear);
  const housing = housingInput.enabled
    ? housingLoanCredit(rules, year, housingInput, pos(values.housingBalance.value), total, special)
    : null;

  // 人的控除差（所得税と住民税の人的控除の差）。調整控除と、ふるさと納税の特例控除の割合の判定に使う
  const diff =
    rules.resident.adjustBasicDiff +
    (selfDisIncome - selfDisResident) +
    (inputs.selfStatus === "widow" && statusOk ? p.widowIncome - p.widowResident : 0) +
    (inputs.selfStatus === "singleParent" && statusOk
      ? p.singleParentIncome - p.singleParentResident
      : 0) +
    (inputs.workingStudent && total <= p.workingStudentIncomeLimit
      ? p.workingStudentIncome - p.workingStudentResident
      : 0) +
    family.members.reduce((s, j) => s + j.adjustDiff, 0);

  const furusatoDonated = pos(values.furusato.value);
  const otherDonation = pos(inputs.otherDonation);
  const withheld = pos(values.withheldTax.value);

  const compute = (fileReturn: boolean) => {
    const donationDeduction =
      fileReturn && furusatoDonated + otherDonation > rules.donation.selfPay
        ? pos(
            Math.min(
              furusatoDonated + otherDonation,
              Math.floor(total * rules.donation.incomeRate),
            ) - rules.donation.selfPay,
          )
        : 0;
    const taxableIncome = floorTo(pos(total - withoutDonation.income - donationDeduction), 1000);
    const taxableIncomeBefore = floorTo(pos(total - withoutDonation.income), 1000);
    const taxableResident = floorTo(pos(total - withoutDonation.resident), 1000);

    // 所得税
    const { tax: baseTax } = incomeTaxOn(rules, taxableIncome);
    const housingCredit = Math.min(housing?.credit ?? 0, baseTax);
    const otherCredit = Math.min(pos(inputs.otherTaxCredit), baseTax - housingCredit);
    const afterCredits = baseTax - housingCredit - otherCredit;
    const surtax = Math.floor(afterCredits * rules.incomeTax.surtaxRate);
    const incomeTaxTotal = floorTo(afterCredits + surtax, 100);
    // ふるさと納税の特例控除の割合は「住民税の課税所得 − 人的控除差」に当てはまる所得税の税率で決める
    // （地方税法 37 条の 2・314 条の 7。0 未満なら税率 0 として 90%）
    const rateBase = taxableResident - diff;
    const marginal = rateBase < 0 ? 0 : incomeTaxOn(rules, Math.max(rateBase, 1)).rate;

    // 住民税
    const r = rules.resident;
    const people = 1 + family.dependentCount;
    const nonTaxable =
      total <=
      r.nonTaxPerPerson * people +
        r.nonTaxBase +
        (family.dependentCount > 0 ? r.nonTaxDependentAdd : 0);
    let levy = nonTaxable ? 0 : Math.floor(taxableResident * r.rate);
    let adjust = 0;
    if (!nonTaxable && total <= r.adjustIncomeLimit) {
      adjust =
        taxableResident <= r.adjustThreshold
          ? Math.floor(Math.min(diff, taxableResident) * r.adjustRate)
          : Math.max(
              Math.floor((diff - (taxableResident - r.adjustThreshold)) * r.adjustRate),
              r.adjustMin,
            );
      adjust = Math.min(adjust, levy);
    }
    levy = pos(levy - adjust);
    const housingResidual = (housing?.credit ?? 0) - housingCredit;
    const housingResident = Math.min(
      pos(housingResidual),
      Math.floor(taxableIncomeBefore * rules.housing.residentRate),
      rules.housing.residentMax,
      levy,
    );

    // ふるさと納税（住民税の寄附金税額控除）
    const d = rules.donation;
    const specialRate = d.furusatoBaseRate - marginal * (1 + rules.incomeTax.surtaxRate);
    const specialCap = Math.floor(levy * d.furusatoCapRate);
    const cap = d.furusatoCapAmount > 0 ? Math.min(specialCap, d.furusatoCapAmount) : specialCap;
    let donationCredit = 0;
    if (furusatoDonated > d.selfPay && !nonTaxable) {
      const over = furusatoDonated - d.selfPay;
      const basic = Math.floor(
        pos(Math.min(furusatoDonated, Math.floor(total * d.residentRate)) - d.selfPay) *
          d.residentBasicRate,
      );
      const specialCredit = Math.min(Math.floor(over * specialRate), cap);
      // ワンストップ特例では、所得税の分（申告特例控除）も住民税から引く
      const oneStop =
        !fileReturn && specialRate > 0
          ? Math.floor(
              (specialCredit * (marginal * (1 + rules.incomeTax.surtaxRate))) / specialRate,
            )
          : 0;
      donationCredit = basic + specialCredit + oneStop;
    }
    const levyAfter = floorTo(pos(levy - housingResident - donationCredit), 100);
    const perCapita = nonTaxable ? 0 : r.perCapita;

    // 上限（所得割 × 20% を特例控除の割合で割り戻す）
    const limit = levy > 0 && specialRate > 0 ? Math.floor(cap / specialRate) + d.selfPay : 0;

    return {
      donationDeduction,
      taxableIncome,
      taxableIncomeBefore,
      taxableResident,
      marginal,
      incomeTax: {
        rate: incomeTaxOn(rules, taxableIncome).rate,
        base: baseTax,
        housingCredit,
        otherCredit,
        surtax,
        total: incomeTaxTotal,
      },
      resident: {
        nonTaxable,
        levy: levy + adjust,
        adjust,
        housingCredit: housingResident,
        donationCredit,
        levyAfter,
        perCapita,
        total: levyAfter + perCapita,
      },
      limit,
    };
  };

  // ── 確定申告の要否（寄附金控除の前の税額で判定する） ──
  const pre = compute(false);
  const f = rules.filing;
  const required: FilingReason[] = [];
  const beneficial: FilingReason[] = [];
  const nonSalary = business + other;
  if (salary > f.salaryThreshold) {
    required.push({
      key: "salaryOver",
      label: `給与収入が ${f.salaryThreshold.toLocaleString()} 円を超える`,
    });
  }
  if (salary > 0 && inputs.yearEndAdjusted && nonSalary > f.otherIncomeThreshold) {
    required.push({
      key: "otherIncome",
      label: `給与以外の所得が ${f.otherIncomeThreshold.toLocaleString()} 円を超える`,
    });
  }
  if (salary === 0 && nonSalary > 0 && pre.incomeTax.total > 0) {
    required.push({ key: "nonSalary", label: "給与以外の所得があり、所得税がかかる" });
  }
  if (
    values.businessIncome.ledger !== null &&
    businessGross !== 0 &&
    !required.some((r) => r.key === "nonSalary")
  ) {
    required.push({ key: "business", label: "事業所得がある（青色申告特別控除も申告が条件）" });
  }
  if (salary > 0 && !inputs.yearEndAdjusted && pre.incomeTax.total > withheld) {
    required.push({
      key: "notAdjustedOwe",
      label: "年末調整を受けておらず、源泉徴収より税額が多い",
    });
  }
  if (chosen === "medical") beneficial.push({ key: "medical", label: "医療費控除" });
  if (chosen === "selfMedication")
    beneficial.push({ key: "selfMedication", label: "セルフメディケーション税制" });
  if (casualty > 0) beneficial.push({ key: "casualty", label: "雑損控除" });
  if (housing?.eligible && housingInput.firstYear) {
    beneficial.push({ key: "housingFirst", label: "住宅ローン控除の初年度" });
  } else if (housing?.eligible && !inputs.yearEndAdjusted) {
    beneficial.push({ key: "housing", label: "住宅ローン控除（年末調整を受けていない）" });
  }
  if (otherDonation > 0)
    beneficial.push({ key: "otherDonation", label: "ふるさと納税以外の寄附金控除" });
  if (
    furusatoDonated > 0 &&
    inputs.furusatoMunicipalities > rules.donation.oneStopMaxMunicipalities
  ) {
    beneficial.push({
      key: "furusatoMany",
      label: `ふるさと納税の寄付先が ${rules.donation.oneStopMaxMunicipalities + 1} 自治体以上`,
    });
  }
  if (salary > 0 && !inputs.yearEndAdjusted && withheld > pre.incomeTax.total) {
    beneficial.push({
      key: "notAdjustedRefund",
      label: "年末調整を受けておらず、源泉徴収された税金が戻る",
    });
  }
  const willFile = required.length > 0 || beneficial.length > 0;
  const result = willFile ? compute(true) : pre;

  if (result.donationDeduction > 0) {
    deductions.push({
      key: "donation",
      label: "寄附金控除",
      income: result.donationDeduction,
      resident: 0,
    });
  }

  // ── ふるさと納税 ──
  const oneStopAvailable =
    !willFile && inputs.furusatoMunicipalities <= rules.donation.oneStopMaxMunicipalities;
  const furusatoWarnings: string[] = [];
  if (furusatoDonated > 0 && willFile) {
    furusatoWarnings.push(
      "確定申告をするとワンストップ特例は無効になります。ふるさと納税の寄附金控除も確定申告に含めてください。",
    );
  }
  if (willFile && housing?.eligible && result.incomeTax.base === 0 && furusatoDonated > 0) {
    furusatoWarnings.push(
      "住宅ローン控除で所得税がゼロになるため、ふるさと納税の所得税の分が戻らず、自己負担が 2,000 円を超える可能性があります。",
    );
  }
  if (furusatoDonated > result.limit && result.limit > 0) {
    furusatoWarnings.push("寄付額が上限の目安を超えています。超えた分は自己負担になります。");
  }

  const refundAmount = withheld - result.incomeTax.total;

  // ── 必要な書類 ──
  const documents: DocumentItem[] = [];
  const doc = (id: string, label: string, why: string) => documents.push({ id, label, why });
  if (salary > 0) doc("withholdingSlip", "源泉徴収票", "給与の収入と源泉徴収税額");
  if (values.businessIncome.ledger !== null)
    doc("businessStatement", "青色申告決算書（または収支内訳書）", "事業所得");
  // 給与天引きの分は証明書が要らない。給与明細を使うときは、自分で払った分があるときだけ
  const selfPaidSocial = payroll ? pos(inputs.payroll.otherSocialInsurance) > 0 : social > 0;
  if (selfPaidSocial && (payroll || !inputs.yearEndAdjusted || salary === 0)) {
    doc("socialInsuranceCert", "社会保険料（国民年金保険料）控除証明書", "社会保険料控除");
  }
  if (aid > 0) doc("mutualAidCert", "小規模企業共済等掛金払込証明書", "iDeCo などの掛金");
  if (life.income > 0) doc("lifeInsuranceCert", "生命保険料控除証明書", "生命保険料控除");
  if (quake > 0) doc("earthquakeCert", "地震保険料控除証明書", "地震保険料控除");
  if (chosen === "medical")
    doc("medicalStatement", "医療費控除の明細書（領収書・医療費通知）", "医療費控除");
  if (chosen === "selfMedication") {
    doc(
      "selfMedicationStatement",
      "セルフメディケーション税制の明細書（対象医薬品のレシート）",
      "セルフメディケーション税制",
    );
    doc(
      "healthCheckProof",
      "健康診断・予防接種などの結果通知や領収書",
      "セルフメディケーション税制の条件",
    );
  }
  if (casualty > 0) doc("casualtyProof", "罹災証明書・災害関連支出の領収書", "雑損控除");
  if (furusatoDonated > 0 || otherDonation > 0) {
    doc("donationReceipt", "寄附金受領証明書（または寄附金控除に関する証明書）", "寄附金控除");
  }
  if (housing?.eligible && housingInput.firstYear) {
    doc("housingCalc", "住宅借入金等特別控除額の計算明細書", "住宅ローン控除の初年度");
    doc("housingBalanceCert", "住宅取得資金に係る借入金の年末残高等証明書", "住宅ローン控除");
    doc(
      "housingContract",
      "売買契約書・請負契約書の写し、登記事項証明書",
      "住宅ローン控除の初年度",
    );
    doc("housingEnergyCert", "住宅の省エネ性能などの証明書", "住宅の区分の証明");
  }
  if (inputs.selfDisability !== "none" || family.members.some((j) => j.disabilityIncome > 0)) {
    doc("disabilityProof", "障害者手帳など", "障害者控除");
  }
  if (willFile)
    doc("myNumber", "マイナンバーカード（または通知カードと本人確認書類）", "申告書の提出");

  if (inputs.housingLoan.enabled && housing?.reason) notes.push(housing.reason);
  if (family.spouse?.kind === "sameHouseholdSpouse") {
    notes.push(
      "本人の合計所得が 1,000 万円を超えるため、配偶者控除は受けられません（同一生計配偶者として障害者控除などの判定には使います）。",
    );
  }

  const deductionTotal = {
    income: deductions.reduce((s, d) => s + d.income, 0),
    resident: deductions.reduce((s, d) => s + d.resident, 0),
  };

  return {
    year,
    values,
    income: { salary, salaryIncome: salaryInc, business, other, total },
    family,
    deductions,
    deductionTotal,
    medicalChoice: { medical, selfMedication: selfMed, chosen },
    taxable: { income: result.taxableIncome, resident: result.taxableResident },
    incomeTax: result.incomeTax,
    resident: result.resident,
    housing,
    payroll: payroll && {
      ...payroll,
      resident: {
        withheldThisYear: payroll.totals.residentTax,
        nextYear: result.resident.total,
        nextMonthly: Math.floor(result.resident.total / 12),
      },
    },
    furusato: {
      limit: result.limit,
      donated: furusatoDonated,
      remaining: pos(result.limit - furusatoDonated),
      path: furusatoDonated <= 0 ? "none" : willFile ? "return" : "oneStop",
      oneStopAvailable,
      warnings: furusatoWarnings,
    },
    refund: { withheld, incomeTax: result.incomeTax.total, amount: refundAmount },
    filing: { required, beneficial, willFile },
    documents,
    notes,
  };
}

/** 生年月日から 12/31 時点の年齢（画面の表示用） */
export function selfAge(inputs: TaxInputs, year: number): number | null {
  return inputs.selfBirthDate ? ageAt(inputs.selfBirthDate, year) : null;
}
