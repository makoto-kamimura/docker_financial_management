import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const BudgetSchema = z.object({
  accountCode: z.string().min(1),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number(),
});

// GET /api/budgets?year=YYYY … 予算一覧
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  const budgets = await prisma.budget.findMany({
    where: { period: { fiscalYear: year } },
    include: {
      account: { select: { id: true, code: true, name: true, category: true } },
      period: { select: { fiscalYear: true, month: true } },
    },
    orderBy: [{ account: { code: "asc" } }, { period: { month: "asc" } }],
  });

  // 年度一覧
  const years = await prisma.period.findMany({
    select: { fiscalYear: true },
    distinct: ["fiscalYear"],
    orderBy: { fiscalYear: "asc" },
  });

  return NextResponse.json({ data: budgets, years: years.map((y) => y.fiscalYear) });
}

// POST /api/budgets … 予算の登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = BudgetSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { accountCode, fiscalYear, month, amount } = parsed.data;

  const account = await prisma.account.findUnique({ where: { code: accountCode } });
  if (!account) return NextResponse.json({ error: `unknown accountCode: ${accountCode}` }, { status: 400 });

  const period = await prisma.period.upsert({
    where: { fiscalYear_month: { fiscalYear, month } },
    update: {},
    create: { fiscalYear, month, quarter: Math.ceil(month / 3) },
  });

  const budget = await prisma.budget.upsert({
    where: { accountId_periodId: { accountId: account.id, periodId: period.id } },
    update: { amount },
    create: { accountId: account.id, periodId: period.id, amount },
    include: {
      account: { select: { id: true, code: true, name: true } },
      period: { select: { fiscalYear: true, month: true } },
    },
  });

  await writeAudit(auth.user.id, "upsert", `budget:${budget.id}`);
  return NextResponse.json({ data: budget }, { status: 201 });
}
