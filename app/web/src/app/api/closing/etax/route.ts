import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/closing/etax?fiscalYear=2025&type=blue_return
// 青色申告決算書 / 法人税申告書の e-Tax 提出用 XML を生成して返す。
// type: "blue_return" (青色申告) | "corporate" (法人税) | "consumption_tax" (消費税)
export async function GET(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const fiscalYear = Number(sp.get("fiscalYear") ?? new Date().getFullYear());
  const type = (sp.get("type") ?? "blue_return") as "blue_return" | "corporate" | "consumption_tax";

  const profile = await prisma.businessProfile.findFirst();
  const taxSetting = await prisma.taxSetting.findFirst({ orderBy: { createdAt: "desc" } });

  const records = await prisma.financialRecord.findMany({
    where: { period: { fiscalYear } },
    include: { account: true, period: true },
  });

  const totals: Record<string, number> = {};
  for (const r of records) {
    const cat = r.account.category;
    totals[cat] = (totals[cat] ?? 0) + Number(r.amount);
  }

  const revenue = totals["REVENUE"] ?? 0;
  const cogs = totals["COGS"] ?? 0;
  const expense = totals["EXPENSE"] ?? 0;
  const grossProfit = revenue - cogs;
  const netIncome = grossProfit - expense;

  const now = new Date();
  const submitAt = now.toISOString().slice(0, 10);
  const ownerName = profile?.ownerName ?? "";
  const tradeName = profile?.tradeName ?? profile?.ownerName ?? "";
  const taxType = taxSetting?.taxationType ?? "exempt";
  const taxRate = taxType === "simplified" ? 0.02 : 0.1;
  const taxAmount = taxType === "exempt" ? 0 : Math.floor(revenue * taxRate);

  let xml: string;

  if (type === "blue_return") {
    xml = buildBlueReturnXml({
      fiscalYear,
      submitAt,
      ownerName,
      tradeName,
      revenue,
      cogs,
      grossProfit,
      expense,
      netIncome,
    });
  } else if (type === "corporate") {
    xml = buildCorporateTaxXml({
      fiscalYear,
      submitAt,
      tradeName,
      revenue,
      expense,
      netIncome,
    });
  } else {
    xml = buildConsumptionTaxXml({
      fiscalYear,
      submitAt,
      ownerName,
      tradeName,
      revenue,
      taxType,
      taxRate,
      taxAmount,
    });
  }

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="etax_${type}_${fiscalYear}.xml"`,
    },
  });
}

// ── XML ビルダ ──────────────────────────────────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBlueReturnXml(p: {
  fiscalYear: number;
  submitAt: string;
  ownerName: string;
  tradeName: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expense: number;
  netIncome: number;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- e-Tax 青色申告決算書 (第一表) -->
<AoiroReturn xmlns="urn:jp:go:nta:etax:bluereturndecl:1.0" version="1.0">
  <Header>
    <SubmitDate>${esc(p.submitAt)}</SubmitDate>
    <FiscalYear>${esc(p.fiscalYear)}</FiscalYear>
    <TaxpayerName>${esc(p.ownerName)}</TaxpayerName>
    <TradeName>${esc(p.tradeName)}</TradeName>
    <FormType>BlueReturn</FormType>
  </Header>
  <IncomeStatement>
    <Revenue>${p.revenue}</Revenue>
    <CostOfGoodsSold>${p.cogs}</CostOfGoodsSold>
    <GrossProfit>${p.grossProfit}</GrossProfit>
    <Expenses>${p.expense}</Expenses>
    <NetBusinessIncome>${p.netIncome}</NetBusinessIncome>
  </IncomeStatement>
</AoiroReturn>`;
}

function buildCorporateTaxXml(p: {
  fiscalYear: number;
  submitAt: string;
  tradeName: string;
  revenue: number;
  expense: number;
  netIncome: number;
}): string {
  const taxBase = Math.max(0, p.netIncome);
  // 法人税率 (中小法人 800万円以下部分: 15%, 超過部分: 23.2%)
  const threshold = 8_000_000;
  const taxLow = Math.min(taxBase, threshold) * 0.15;
  const taxHigh = Math.max(0, taxBase - threshold) * 0.232;
  const corporateTax = Math.floor(taxLow + taxHigh);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- e-Tax 法人税申告書 (別表一) -->
<CorporateTaxReturn xmlns="urn:jp:go:nta:etax:corptaxdecl:1.0" version="1.0">
  <Header>
    <SubmitDate>${esc(p.submitAt)}</SubmitDate>
    <FiscalYear>${esc(p.fiscalYear)}</FiscalYear>
    <CorporateName>${esc(p.tradeName)}</CorporateName>
    <FormType>CorporateTax</FormType>
  </Header>
  <TaxBase>
    <Revenue>${p.revenue}</Revenue>
    <TotalExpenses>${p.expense}</TotalExpenses>
    <TaxableIncome>${taxBase}</TaxableIncome>
  </TaxBase>
  <TaxCalculation>
    <LowRatePortion>${Math.min(taxBase, threshold)}</LowRatePortion>
    <LowRateTax>${Math.floor(taxLow)}</LowRateTax>
    <HighRatePortion>${Math.max(0, taxBase - threshold)}</HighRatePortion>
    <HighRateTax>${Math.floor(taxHigh)}</HighRateTax>
    <CorporateTax>${corporateTax}</CorporateTax>
  </TaxCalculation>
</CorporateTaxReturn>`;
}

function buildConsumptionTaxXml(p: {
  fiscalYear: number;
  submitAt: string;
  ownerName: string;
  tradeName: string;
  revenue: number;
  taxType: string;
  taxRate: number;
  taxAmount: number;
}): string {
  const typeLabel: Record<string, string> = {
    exempt: "免税",
    general: "原則課税",
    simplified: "簡易課税",
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- e-Tax 消費税申告書 -->
<ConsumptionTaxReturn xmlns="urn:jp:go:nta:etax:consumptaxdecl:1.0" version="1.0">
  <Header>
    <SubmitDate>${esc(p.submitAt)}</SubmitDate>
    <FiscalYear>${esc(p.fiscalYear)}</FiscalYear>
    <TaxpayerName>${esc(p.ownerName)}</TaxpayerName>
    <TradeName>${esc(p.tradeName)}</TradeName>
    <TaxMethod>${esc(typeLabel[p.taxType] ?? p.taxType)}</TaxMethod>
  </Header>
  <TaxBase>
    <TaxableRevenue>${p.revenue}</TaxableRevenue>
    <TaxRate>${p.taxRate}</TaxRate>
    <ConsumptionTax>${p.taxAmount}</ConsumptionTax>
  </TaxBase>
</ConsumptionTaxReturn>`;
}
