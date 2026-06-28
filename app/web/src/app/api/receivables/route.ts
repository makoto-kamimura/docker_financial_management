import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/receivables?status=open&year=2026
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const year = sp.get("year") ? Number(sp.get("year")) : undefined;

  const where: Record<string, unknown> = {};
  if (status && status !== "all") where.status = status;
  if (year) {
    where.issueDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }

  const list = await prisma.receivable.findMany({
    where,
    orderBy: { dueDate: "asc" },
  });
  return NextResponse.json({ data: list });
}

// POST /api/receivables
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    customerName: string;
    description: string;
    amount: number;
    taxAmount?: number;
    issueDate: string;
    dueDate: string;
    invoiceNumber?: string;
    note?: string;
  };

  if (!body.customerName || !body.description || !body.amount || !body.issueDate || !body.dueDate) {
    return NextResponse.json(
      { error: "customerName, description, amount, issueDate, dueDate are required" },
      { status: 400 },
    );
  }

  const record = await prisma.receivable.create({
    data: {
      customerName: body.customerName,
      description: body.description,
      amount: body.amount,
      taxAmount: body.taxAmount ?? 0,
      issueDate: new Date(body.issueDate),
      dueDate: new Date(body.dueDate),
      invoiceNumber: body.invoiceNumber ?? null,
      note: body.note ?? null,
    },
  });

  // FinancialRecord に売掛金として反映
  const arAccount = await prisma.account.findFirst({ where: { code: "1300" } });
  if (arAccount) {
    const period = await prisma.period.upsert({
      where: {
        fiscalYear_month: {
          fiscalYear: record.issueDate.getFullYear(),
          month: record.issueDate.getMonth() + 1,
        },
      },
      update: {},
      create: {
        fiscalYear: record.issueDate.getFullYear(),
        month: record.issueDate.getMonth() + 1,
        quarter: Math.ceil((record.issueDate.getMonth() + 1) / 3),
      },
    });
    await prisma.financialRecord.create({
      data: { accountId: arAccount.id, periodId: period.id, amount: body.amount },
    });
  }

  return NextResponse.json({ data: record }, { status: 201 });
}
