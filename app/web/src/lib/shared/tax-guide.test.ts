import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_RULES } from "./tax-rules";
import { emptyTaxInputs, estimateTax, type DeductionKey, type TaxLedger } from "./tax-estimate";
import { DEDUCTION_GUIDES, buildTodos, yearGuideFor } from "./tax-guide";

const ledger: TaxLedger = {
  salary: 5_000_000,
  socialInsurance: 750_000,
  withheldTax: 0,
  lifeGeneral: 0,
  lifeCare: 0,
  medical: 0,
  furusato: 30_000,
  businessIncome: null,
  blueReturnDeduction: null,
  housingBalance: null,
  sideIncome: 0,
  fireEarthquake: 0,
  otherDonation: 0,
};

describe("DEDUCTION_GUIDES", () => {
  it("計算に出てくる控除にはすべて説明がある", () => {
    const keys: DeductionKey[] = [
      "socialInsurance",
      "smallBusinessMutualAid",
      "lifeInsurance",
      "earthquake",
      "medical",
      "casualty",
      "spouse",
      "dependents",
      "specifiedRelative",
      "disability",
      "widow",
      "singleParent",
      "workingStudent",
      "basic",
      "donation",
    ];
    const guided = new Set(DEDUCTION_GUIDES.map((g) => g.key));
    for (const k of keys) expect(guided, k).toContain(k);
  });
});

describe("yearGuideFor", () => {
  it("用意がない年は直前の年の説明を返す", () => {
    expect(yearGuideFor(2026)?.year).toBe(2026);
    expect(yearGuideFor(2027)?.year).toBe(2026);
    expect(yearGuideFor(2020)).toBeNull();
  });
});

describe("buildTodos", () => {
  it("当てはまるものだけを日付順に並べる", () => {
    const e = estimateTax(DEFAULT_TAX_RULES[2026], 2026, ledger, {
      ...emptyTaxInputs(2026),
      furusatoMunicipalities: 2,
    });
    const todos = buildTodos(2026, e);
    const ids = todos.map((t) => t.id);
    expect(ids).toContain("yearEndDocs");
    expect(ids).toContain("oneStopForm");
    expect(ids).toContain("residentNotice");
    expect(ids).not.toContain("taxReturn");
    expect([...todos].sort((a, b) => a.due.localeCompare(b.due))).toEqual(todos);
  });
});
