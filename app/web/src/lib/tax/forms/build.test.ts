import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_RULES } from "@/lib/shared/tax-rules";
import {
  emptyTaxInputs,
  estimateTax,
  type TaxInputs,
  type TaxLedger,
} from "@/lib/shared/tax-estimate";
import { buildForms, taxLines, type FormContext, type FormDoc } from "./build";

const r2026 = DEFAULT_TAX_RULES[2026];

const ledger = (over: Partial<TaxLedger> = {}): TaxLedger => ({
  salary: 5_000_000,
  salaryDeposit: 0,
  socialInsurance: 750_000,
  withheldTax: 120_000,
  lifeGeneral: 0,
  lifeCare: 0,
  medical: 0,
  selfMedication: 0,
  furusato: 0,
  businessIncome: null,
  blueReturnDeduction: null,
  housingBalance: null,
  sideIncome: 0,
  pensionIncome: 0,
  realEstateIncome: 0,
  householdBusinessIncome: 0,
  cryptoIncome: 0,
  fireEarthquake: 0,
  otherDonation: 0,
  insuranceRefund: 0,
  plan: { fromMonth: null, status: "actual" },
  planned: {},
  ...over,
});

function context(l: TaxLedger, over: Partial<TaxInputs> = {}, rest: Partial<FormContext> = {}) {
  const inputs = { ...emptyTaxInputs(2026), ...over };
  return {
    year: 2026,
    estimate: estimateTax(r2026, 2026, l, inputs),
    inputs,
    ledger: l,
    medicalEntries: [],
    furusatoEntries: [],
    selfMedicationReceipts: [],
    ...rest,
  } satisfies FormContext;
}

const doc = (docs: FormDoc[], key: string) => docs.find((d) => d.key === key)!;
const rowValue = (d: FormDoc, no: string) =>
  d.pages[0].sections.flatMap((s) => s.rows ?? []).find((r) => r.no === no)?.value;

describe("申告書の要否", () => {
  it("年末調整で済む会社員は年末調整の申告書だけ。ふるさと納税があればワンストップ特例", () => {
    const docs = buildForms(
      context(
        ledger({ furusato: 30_000, lifeGeneral: 80_000 }),
        {},
        {
          furusatoEntries: [
            { date: "2026-11-01", payee: "A市", code: "H-3039", amount: 20_000 },
            { date: "2026-12-01", payee: "B町", code: "H-3039", amount: 10_000 },
          ],
        },
      ),
    );
    const needed = docs.filter((d) => d.needed).map((d) => d.key);
    expect(needed).toEqual([
      "year-end-dependents",
      "year-end-basic",
      "year-end-insurance",
      "one-stop",
    ]);
    // ワンストップ特例申請書は寄附先ごとに 1 ページ
    expect(doc(docs, "one-stop").pages).toHaveLength(2);
  });

  it("医療費控除を受けるなら確定申告書と医療費控除の明細書", () => {
    const docs = buildForms(
      context(
        ledger({ medical: 180_000 }),
        {},
        {
          medicalEntries: [
            { date: "2026-03-01", payee: "Aクリニック", code: "H-2005", amount: 100_000 },
            { date: "2026-04-01", payee: "Aクリニック", code: "H-2005", amount: 50_000 },
            { date: "2026-05-01", payee: "B薬局", code: "H-2006", amount: 30_000 },
          ],
        },
      ),
    );
    const needed = docs.filter((d) => d.needed).map((d) => d.key);
    expect(needed).toEqual(expect.arrayContaining(["return-1", "return-2", "medical"]));
    expect(needed).not.toContain("self-medication");
    const table = doc(docs, "medical").pages[0].sections[0].table!;
    expect(table.rows).toEqual([
      ["", "Aクリニック（2件）", "診療・治療", "150,000円", ""],
      ["", "B薬局（1件）", "医薬品購入", "30,000円", ""],
    ]);
  });
});

describe("第一表の値", () => {
  it("控除と税額は見込みと同じ。㊻ − ㊾ が還付（または 100 円未満を切り捨てた申告納税額）", () => {
    const c = context(ledger({ medical: 180_000 }));
    const docs = buildForms(c);
    const first = doc(docs, "return-1");
    const e = c.estimate;
    expect(rowValue(first, "⑬")).toBe("750,000円");
    expect(rowValue(first, "㉚")).toBe(`${e.deductionTotal.income.toLocaleString("ja-JP")}円`);
    expect(rowValue(first, "㉛")).toBe(`${e.taxable.income.toLocaleString("ja-JP")}円`);
    const t = taxLines(e);
    expect(t.total).toBe(e.incomeTax.base - e.incomeTax.housingCredit + e.incomeTax.surtax);
    expect(t.refund).toBe(Math.max(0, 120_000 - t.total));
    expect(rowValue(first, "㊾")).toBe("120,000円");
  });

  it("納める場合は 100 円未満を切り捨てる", () => {
    const e = estimateTax(r2026, 2026, ledger({ withheldTax: 0 }), emptyTaxInputs(2026));
    const t = taxLines(e);
    expect(t.payable).toBe(Math.floor(t.total / 100) * 100);
    expect(t.refund).toBe(0);
  });
  it("予定納税は申告納税額 ㊿ から引いて第３期分（52・53）を出す", () => {
    const c = context(ledger({ withheldTax: 0 }), { prepaidTax: 1_000_000 });
    const t = taxLines(c.estimate);
    expect(t.filed).toBe(Math.floor(t.total / 100) * 100);
    expect(t.prepaid).toBe(1_000_000);
    expect(t.payable).toBe(0);
    expect(t.refund).toBe(1_000_000 - t.filed);
    const first = doc(buildForms(c), "return-1");
    expect(rowValue(first, "51")).toBe("1,000,000円");
    expect(rowValue(first, "53")).toBe(`${t.refund.toLocaleString("ja-JP")}円`);
  });

  it("源泉徴収税額が多いと申告納税額 ㊿ は △ を付けた赤字", () => {
    const c = context(ledger({ withheldTax: 1_000_000 }));
    const t = taxLines(c.estimate);
    expect(t.filed).toBe(t.total - 1_000_000);
    expect(rowValue(doc(buildForms(c), "return-1"), "㊿")).toBe(
      `△${(1_000_000 - t.total).toLocaleString("ja-JP")}円`,
    );
  });

  it("所得金額調整控除を引いた給与所得 ⑥ に注記を付ける", () => {
    const kid = {
      id: "k",
      name: "",
      relation: "child" as const,
      birthDate: "2016-05-01",
      salary: 0,
      otherIncome: 0,
      livingTogether: true,
      disability: "none" as const,
      dependentOfOther: false,
    };
    const c = context(ledger({ salary: 9_000_000 }), { family: [kid] });
    const row = doc(buildForms(c), "return-1")
      .pages[0].sections.flatMap((s) => s.rows ?? [])
      .find((r) => r.no === "⑥");
    expect(row?.value).toBe("7,000,000円");
    expect(row?.note).toMatch(/所得金額調整控除 50,000円/);
  });
});
