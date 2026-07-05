import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { invalidateCache } from "@/lib/redis";

const INCLUDE_DETAILS = {
  details: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { side: "asc" as const },
  },
  receipts: { orderBy: { uploadedAt: "desc" as const } },
};

// GET /api/journals?year=2026&month=6&page=1&limit=50
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const sp = req.nextUrl.searchParams;
  const year = sp.get("year") ? Number(sp.get("year")) : undefined;
  const month = sp.get("month") ? Number(sp.get("month")) : undefined;
  const page = Math.max(1, Number(sp.get("page") ?? "1"));
  const limit = Math.min(200, Number(sp.get("limit") ?? "50"));

  let dateFrom: Date | undefined;
  let dateTo: Date | undefined;
  if (year && month) {
    dateFrom = new Date(year, month - 1, 1);
    dateTo = new Date(year, month, 1);
  } else if (year) {
    dateFrom = new Date(year, 0, 1);
    dateTo = new Date(year + 1, 0, 1);
  }

  const where = {
    tenantId,
    ...(dateFrom ? { transactionDate: { gte: dateFrom, lt: dateTo } } : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({
      where,
      include: INCLUDE_DETAILS,
      orderBy: { transactionDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({ data: entries, total, page, limit });
}

type DetailInput = { side: "debit" | "credit"; accountId: number; amount: number; note?: string };

// POST /api/journals — 仕訳登録（ヘッダ + 明細をまとめて）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as {
    transactionDate: string;
    description: string;
    paymentMethod?: string;
    taxCategory?: string;
    details: DetailInput[];
  };

  if (!body.transactionDate || !body.description || !body.details?.length) {
    return NextResponse.json(
      { error: "transactionDate, description, details are required" },
      { status: 400 },
    );
  }

  const debitTotal = body.details
    .filter((d) => d.side === "debit")
    .reduce((s, d) => s + d.amount, 0);
  const creditTotal = body.details
    .filter((d) => d.side === "credit")
    .reduce((s, d) => s + d.amount, 0);
  if (Math.abs(debitTotal - creditTotal) > 0.01) {
    return NextResponse.json(
      { error: `借方合計(${debitTotal})と貸方合計(${creditTotal})が一致しません` },
      { status: 400 },
    );
  }

  const entry = await prisma.journalEntry.create({
    data: {
      tenantId,
      transactionDate: new Date(body.transactionDate),
      description: body.description,
      paymentMethod: body.paymentMethod ?? "cash",
      taxCategory: body.taxCategory ?? "taxable",
      details: {
        create: body.details.map((d) => ({
          side: d.side,
          accountId: d.accountId,
          amount: d.amount,
          note: d.note ?? null,
        })),
      },
    },
    include: INCLUDE_DETAILS,
  });

  await syncToFinancialRecords(
    tenantId,
    entry.transactionDate,
    entry.details.map((d) => ({ accountId: d.accountId, amount: Number(d.amount) })),
  );

  const year = entry.transactionDate.getFullYear();
  await invalidateCache(`closing:statements:${year}`);
  await invalidateCache(`reports:ledger:${year}:*`);

  return NextResponse.json({ data: entry }, { status: 201 });
}

async function syncToFinancialRecords(
  tenantId: number,
  transactionDate: Date,
  details: { accountId: number; amount: number }[],
) {
  const fiscalYear = transactionDate.getFullYear();
  const month = transactionDate.getMonth() + 1;

  const period = await prisma.period.upsert({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
    update: {},
    create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
  });

  await prisma.financialRecord.createMany({
    data: details.map((d) => ({
      tenantId,
      accountId: d.accountId,
      periodId: period.id,
      amount: d.amount,
    })),
  });
}
