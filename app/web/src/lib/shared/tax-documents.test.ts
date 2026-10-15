import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_RULES } from "./tax-rules";
import { emptyTaxInputs, estimateTax, type TaxLedger } from "./tax-estimate";
import {
  TAX_DOCUMENTS,
  documentStatus,
  documentsAt,
  isTaxDocumentId,
  showDocument,
} from "./tax-documents";

const r2026 = DEFAULT_TAX_RULES[2026];
const ledger = (over: Partial<TaxLedger> = {}): TaxLedger => ({
  salary: 5_000_000,
  salaryDeposit: 0,
  socialInsurance: 750_000,
  withheldTax: 100_000,
  lifeGeneral: 80_000,
  lifeCare: 0,
  medical: 200_000,
  selfMedication: 0,
  furusato: 30_000,
  businessIncome: 1_000_000,
  blueReturnDeduction: 650_000,
  housingBalance: 30_000_000,
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

describe("TAX_DOCUMENTS", () => {
  it("必要な書類に出る id はすべて一覧にあり、名前も一覧と同じ", () => {
    const inputs = {
      ...emptyTaxInputs(2026),
      selfDisability: "general" as const,
      earthquake: 30_000,
      smallBusinessMutualAid: 276_000,
      housingLoan: {
        ...emptyTaxInputs(2026).housingLoan,
        enabled: true,
        movedInYear: 2026,
        firstYear: true,
      },
    };
    const e = estimateTax(r2026, 2026, ledger(), inputs);
    expect(e.documents.length).toBeGreaterThan(8);
    for (const d of e.documents) {
      expect(isTaxDocumentId(d.id)).toBe(true);
      if (isTaxDocumentId(d.id)) expect(d.label).toBe(TAX_DOCUMENTS[d.id].label);
    }
  });

  it("置き場所ごとに書類を引ける。マイナンバーは保存しない", () => {
    expect(documentsAt("income")).toEqual(["withholdingSlip"]);
    expect(documentsAt("housing")).toEqual([
      "housingCalc",
      "housingBalanceCert",
      "housingContract",
      "housingEnergyCert",
    ]);
    expect(TAX_DOCUMENTS.myNumber.uploadable).toBe(false);
  });

  it("住宅の年末残高等証明書は 2 年目以降も出る（ほかの住宅の書類は初年度だけ）", () => {
    const base = emptyTaxInputs(2026);
    const e = estimateTax(r2026, 2026, ledger(), {
      ...base,
      housingLoan: { ...base.housingLoan, enabled: true, movedInYear: 2025, firstYear: false },
    });
    const ids = e.documents.map((d) => d.id);
    expect(ids).toContain("housingBalanceCert");
    expect(ids).not.toContain("housingContract");
  });
});

describe("documentStatus / showDocument", () => {
  const docs = [{ id: "withholdingSlip" }, { id: "selfMedicationStatement" }, { id: "myNumber" }];
  const files = [
    { docId: "withholdingSlip" },
    { docId: "withholdingSlip" },
    { docId: "lifeInsuranceCert" },
  ];

  it("書類ごとの枚数。セルフメディケーションはレシートの枚数", () => {
    expect(documentStatus(docs, files, 3)).toEqual([
      { id: "withholdingSlip", count: 2, uploadable: true },
      { id: "selfMedicationStatement", count: 3, uploadable: false },
      { id: "myNumber", count: 0, uploadable: false },
    ]);
  });

  it("要るか、すでにファイルがあれば出す", () => {
    expect(showDocument("withholdingSlip", docs, [])).toBe(true);
    expect(showDocument("lifeInsuranceCert", docs, files)).toBe(true);
    expect(showDocument("earthquakeCert", docs, files)).toBe(false);
  });
});
