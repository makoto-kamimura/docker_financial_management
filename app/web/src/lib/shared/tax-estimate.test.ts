import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_RULES } from "./tax-rules";
import {
  emptyTaxInputs,
  estimateTax,
  housingLoanCredit,
  lifeInsuranceDeduction,
  type TaxInputs,
  type TaxLedger,
} from "./tax-estimate";
import type { FamilyMember } from "./tax-family";

const r2025 = DEFAULT_TAX_RULES[2025];
const r2026 = DEFAULT_TAX_RULES[2026];

const ledger = (over: Partial<TaxLedger> = {}): TaxLedger => ({
  salary: 0,
  socialInsurance: 0,
  withheldTax: 0,
  lifeGeneral: 0,
  lifeCare: 0,
  medical: 0,
  furusato: 0,
  businessIncome: null,
  blueReturnDeduction: null,
  housingBalance: null,
  sideIncome: 0,
  fireEarthquake: 0,
  otherDonation: 0,
  ...over,
});

const inputs = (over: Partial<TaxInputs> = {}, year = 2026): TaxInputs => ({
  ...emptyTaxInputs(year),
  ...over,
});

const child = (birthDate: string): FamilyMember => ({
  id: birthDate,
  name: "",
  relation: "child",
  birthDate,
  salary: 0,
  otherIncome: 0,
  livingTogether: true,
  disability: "none",
  dependentOfOther: false,
});

// 社会保険料は給与の 15% とする（総務省の目安表の前提に近い）
const salaried = (salary: number) => ledger({ salary, socialInsurance: Math.round(salary * 0.15) });

describe("所得税（2026 年分）", () => {
  it("年収 178 万円までは所得税がかからない（社会保険料なしの目安）", () => {
    expect(estimateTax(r2026, 2026, ledger({ salary: 1_780_000 }), inputs()).incomeTax.total).toBe(
      0,
    );
    expect(
      estimateTax(r2026, 2026, ledger({ salary: 1_790_000 }), inputs()).incomeTax.total,
    ).toBeGreaterThan(0);
    // 2025 年分の基準では 160 万円で既にかかる
    expect(
      estimateTax(r2025, 2025, ledger({ salary: 1_700_000 }), inputs({}, 2025)).incomeTax.total,
    ).toBeGreaterThan(0);
  });

  it("年収 500 万円・独身", () => {
    const e = estimateTax(r2026, 2026, salaried(5_000_000), inputs());
    expect(e.income.salaryIncome).toBe(3_560_000);
    // 基礎控除は合計所得 489 万円以下で 104 万円
    expect(e.deductions.find((d) => d.key === "basic")).toMatchObject({
      income: 1_040_000,
      resident: 430_000,
    });
    expect(e.taxable.income).toBe(1_770_000);
    // 1,770,000 × 5% = 88,500、復興特別所得税 1,858 → 100 円未満切り捨て
    expect(e.incomeTax.total).toBe(90_300);
    // 住民税: 課税所得 2,380,000 × 10% − 調整控除 2,500 ＋ 均等割 5,000
    expect(e.taxable.resident).toBe(2_380_000);
    expect(e.resident.levyAfter).toBe(235_500);
    expect(e.resident.total).toBe(240_500);
  });

  it("基礎控除の特例は合計所得 489 万円・655 万円で段が変わる", () => {
    const basic = (salary: number) =>
      estimateTax(r2026, 2026, ledger({ salary }), inputs()).deductions.find(
        (d) => d.key === "basic",
      )!.income;
    expect(basic(6_600_000)).toBe(1_040_000); // 所得 4,880,000
    expect(basic(6_700_000)).toBe(670_000); // 所得 4,970,000
    expect(basic(8_500_000)).toBe(670_000); // 所得 6,550,000 ちょうど
    expect(basic(8_600_000)).toBe(620_000); // 所得 6,650,000
  });
});

describe("ふるさと納税の上限（総務省の目安表に近いこと）", () => {
  // 目安表（独身・共働き）: 年収 300 万円 28,000 円、500 万円 61,000 円、800 万円 129,000 円、1,000 万円 180,000 円
  it.each([
    [3_000_000, 28_000],
    [5_000_000, 61_000],
    [8_000_000, 129_000],
    [10_000_000, 180_000],
  ])("年収 %i 円 → 約 %i 円", (salary, expected) => {
    const e = estimateTax(r2026, 2026, salaried(salary), inputs());
    expect(e.furusato.limit).toBeGreaterThanOrEqual(expected * 0.97);
    expect(e.furusato.limit).toBeLessThanOrEqual(expected * 1.05);
  });

  it("夫婦（配偶者控除あり）・子 1 人（高校生）は上限が下がる", () => {
    const spouse: FamilyMember = { ...child("1990-01-01"), id: "s", relation: "spouse" };
    const single = estimateTax(r2026, 2026, salaried(5_000_000), inputs());
    const family = estimateTax(
      r2026,
      2026,
      salaried(5_000_000),
      inputs({ family: [spouse, child("2009-06-01")] }),
    );
    expect(family.furusato.limit).toBeLessThan(single.furusato.limit);
    // 目安表: 年収 500 万円・夫婦＋高校生 1 人 → 40,000 円
    expect(family.furusato.limit).toBeGreaterThanOrEqual(38_000);
    expect(family.furusato.limit).toBeLessThanOrEqual(43_000);
  });

  it("残り枠は寄付済みを引いた額。ワンストップ特例なら住民税からまとめて引く", () => {
    const e = estimateTax(
      r2026,
      2026,
      salaried(5_000_000),
      inputs({ furusato: 30_000, furusatoMunicipalities: 3 }),
    );
    expect(e.furusato.remaining).toBe(e.furusato.limit - 30_000);
    expect(e.furusato.path).toBe("oneStop");
    expect(e.furusato.oneStopAvailable).toBe(true);
    // 自己負担 2,000 円を除いた 28,000 円が住民税から引かれる（端数の誤差は数円）
    expect(e.resident.donationCredit).toBeGreaterThanOrEqual(27_990);
    expect(e.resident.donationCredit).toBeLessThanOrEqual(28_000);
  });

  it("6 自治体以上なら確定申告になり、所得税と住民税に分かれる", () => {
    const e = estimateTax(
      r2026,
      2026,
      salaried(5_000_000),
      inputs({ furusato: 30_000, furusatoMunicipalities: 6 }),
    );
    expect(e.filing.willFile).toBe(true);
    expect(e.furusato.path).toBe("return");
    expect(e.deductions.find((d) => d.key === "donation")?.income).toBe(28_000);
  });
});

describe("生命保険料控除", () => {
  const paid = { generalNew: 100_000, generalOld: 0, care: 0, pensionNew: 0, pensionOld: 0 };
  it("一般・新は所得税 4 万円・住民税 2.8 万円まで", () => {
    expect(lifeInsuranceDeduction(r2026, paid, false)).toEqual({
      income: 40_000,
      resident: 28_000,
    });
  });

  it("23 歳未満の扶養親族がいれば 2026 年分は所得税 6 万円まで（住民税は据え置き）", () => {
    expect(lifeInsuranceDeduction(r2026, { ...paid, generalNew: 120_000 }, true)).toEqual({
      income: 60_000,
      resident: 28_000,
    });
    // 2025 年分には特例がない
    expect(lifeInsuranceDeduction(r2025, { ...paid, generalNew: 120_000 }, true).income).toBe(
      40_000,
    );
  });

  it("新旧両方なら区分の上限 4 万円、旧だけなら 5 万円まで。合計は 12 万円", () => {
    expect(
      lifeInsuranceDeduction(r2026, { ...paid, generalNew: 30_000, generalOld: 30_000 }, false)
        .income,
    ).toBe(40_000);
    expect(
      lifeInsuranceDeduction(r2026, { ...paid, generalNew: 0, generalOld: 120_000 }, false).income,
    ).toBe(50_000);
    const all = {
      generalNew: 0,
      generalOld: 120_000,
      care: 100_000,
      pensionNew: 0,
      pensionOld: 120_000,
    };
    expect(lifeInsuranceDeduction(r2026, all, false).income).toBe(120_000);
    expect(lifeInsuranceDeduction(r2026, all, false).resident).toBe(70_000);
  });
});

describe("医療費控除とセルフメディケーション税制", () => {
  it("控除額の大きい方を選ぶ", () => {
    const e = estimateTax(
      r2026,
      2026,
      ledger({ salary: 5_000_000, medical: 150_000 }),
      inputs({ selfMedication: 40_000, selfMedicationEligible: true }),
    );
    expect(e.medicalChoice).toEqual({ medical: 50_000, selfMedication: 28_000, chosen: "medical" });
    expect(e.filing.beneficial.map((b) => b.key)).toContain("medical");
    expect(e.documents.map((d) => d.id)).toContain("medicalStatement");
  });

  it("所得が低いと足切りは所得の 5%", () => {
    const e = estimateTax(r2026, 2026, ledger({ salary: 1_500_000, medical: 50_000 }), inputs());
    // 所得 760,000 × 5% = 38,000 を超えた 12,000 円
    expect(e.medicalChoice.medical).toBe(12_000);
  });
});

describe("住宅ローン控除", () => {
  const loan = (over: Partial<TaxInputs["housingLoan"]>): TaxInputs["housingLoan"] => ({
    ...emptyTaxInputs(2026).housingLoan,
    enabled: true,
    ...over,
  });

  it("2026 年入居の新築 ZEH は 3,500 万円、子育て世帯は 4,500 万円まで", () => {
    expect(
      housingLoanCredit(r2026, 2026, loan({ movedInYear: 2026 }), 40_000_000, 5_000_000, false)
        .credit,
    ).toBe(245_000);
    expect(
      housingLoanCredit(r2026, 2026, loan({ movedInYear: 2026 }), 40_000_000, 5_000_000, true)
        .credit,
    ).toBe(280_000);
  });

  it("2026 年入居の既存・省エネ基準適合は 2,000 万円・13 年（子育て世帯 3,000 万円）", () => {
    const h = housingLoanCredit(
      r2026,
      2026,
      loan({ movedInYear: 2026, build: "used", energy: "energy" }),
      25_000_000,
      5_000_000,
      false,
    );
    expect(h).toMatchObject({ credit: 140_000, limit: 20_000_000, years: 13 });
  });

  it("2024 年入居の省エネ基準を満たさない新築は対象外、令和3年以前の入居は直接入力", () => {
    expect(
      housingLoanCredit(
        r2026,
        2026,
        loan({ movedInYear: 2024, energy: "other" }),
        20_000_000,
        5_000_000,
        false,
      ).eligible,
    ).toBe(false);
    expect(
      housingLoanCredit(r2026, 2026, loan({ movedInYear: 2020 }), 20_000_000, 5_000_000, false)
        .reason,
    ).toMatch(/直接/);
  });

  it("所得税から引ききれない分は住民税から引く（課税所得の 5%・9.75 万円まで）", () => {
    const e = estimateTax(
      r2026,
      2026,
      salaried(4_000_000),
      inputs({ housingLoan: loan({ movedInYear: 2026, balance: 40_000_000 }) }),
    );
    expect(e.incomeTax.total).toBe(0);
    expect(e.resident.housingCredit).toBeGreaterThan(0);
    expect(e.resident.housingCredit).toBeLessThanOrEqual(97_500);
  });

  it("初年度は確定申告が必要で、書類の一覧に年末残高証明書が入る", () => {
    const e = estimateTax(
      r2026,
      2026,
      salaried(6_000_000),
      inputs({ housingLoan: loan({ movedInYear: 2026, balance: 30_000_000, firstYear: true }) }),
    );
    expect(e.filing.beneficial.map((b) => b.key)).toContain("housingFirst");
    expect(e.documents.map((d) => d.id)).toContain("housingBalanceCert");
  });
});

describe("確定申告の要否と還付", () => {
  it("年末調整済みで医療費などがなければ申告不要", () => {
    const e = estimateTax(r2026, 2026, salaried(5_000_000), inputs());
    expect(e.filing.willFile).toBe(false);
    expect(e.filing.required).toEqual([]);
  });

  it("給与以外の所得が 20 万円を超えると申告が必要", () => {
    const e = estimateTax(r2026, 2026, salaried(5_000_000), inputs({ otherIncome: 250_000 }));
    expect(e.filing.required.map((r) => r.key)).toContain("otherIncome");
  });

  it("還付見込みは源泉徴収済み − 所得税の見込み", () => {
    const e = estimateTax(r2026, 2026, { ...salaried(5_000_000), withheldTax: 120_000 }, inputs());
    expect(e.refund.amount).toBe(120_000 - e.incomeTax.total);
  });

  it("個人事業主は青色申告特別控除を引いた事業所得で計算し、申告が必要", () => {
    const e = estimateTax(
      r2026,
      2026,
      ledger({ businessIncome: 4_000_000, blueReturnDeduction: 650_000, socialInsurance: 500_000 }),
      inputs(),
    );
    expect(e.income.business).toBe(3_350_000);
    expect(e.filing.required.length).toBeGreaterThan(0);
    expect(e.documents.map((d) => d.id)).toContain("businessStatement");
  });

  it("帳簿の値を手入力で上書きできる", () => {
    const e = estimateTax(r2026, 2026, salaried(5_000_000), inputs({ salary: 6_000_000 }));
    expect(e.values.salary).toEqual({ value: 6_000_000, source: "input", ledger: 5_000_000 });
    expect(e.income.salary).toBe(6_000_000);
  });
});
