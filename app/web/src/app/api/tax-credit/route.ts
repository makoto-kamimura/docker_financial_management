import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());

  const details = await prisma.journalDetail.findMany({
    where: {
      side: "debit",
      taxRate: { not: null },
      journalEntry: {
        tenantId,
        transactionDate: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    },
    select: {
      amount: true,
      taxRate: true,
      taxCreditEligible: true,
      account: { select: { code: true, name: true, category: true } },
      journalEntry: { select: { transactionDate: true, description: true } },
    },
  });

  let eligibleTax = 0;
  let ineligibleTax = 0;
  let eligibleBase = 0;
  let ineligibleBase = 0;

  for (const d of details) {
    const rate = Number(d.taxRate);
    const base = Number(d.amount);
    const taxAmt = Math.floor(base * rate);
    if (d.taxCreditEligible) {
      eligibleBase += base;
      eligibleTax += taxAmt;
    } else {
      ineligibleBase += base;
      ineligibleTax += taxAmt;
    }
  }

  return NextResponse.json({
    data: {
      year,
      eligibleBase,
      eligibleTax,
      ineligibleBase,
      ineligibleTax,
      totalPurchaseTax: eligibleTax + ineligibleTax,
      creditableTax: eligibleTax,
      details: details.length,
    },
  });
}
