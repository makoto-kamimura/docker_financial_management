import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const year = sp.get("year") ? Number(sp.get("year")) : undefined;

  const where: Record<string, unknown> = { tenantId };
  if (status && status !== "all") where.status = status;
  if (year) {
    where.issueDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }

  const list = await db.receivable.findMany({ where, orderBy: { dueDate: "asc" } });
  return NextResponse.json({ data: list });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
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

  const record = await db.receivable.create({
    data: {
      tenantId,
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

  const arAccount = await db.account.findFirst({ where: { tenantId, code: "1300" } });
  if (arAccount) {
    const fiscalYear = record.issueDate.getFullYear();
    const month = record.issueDate.getMonth() + 1;
    const period = await db.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
      update: {},
      create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
    });
    await db.financialRecord.create({
      data: { tenantId, accountId: arAccount.id, periodId: period.id, amount: body.amount },
    });
  }

  return NextResponse.json({ data: record }, { status: 201 });
}
