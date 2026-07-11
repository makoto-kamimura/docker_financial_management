import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
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

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  const budgets = await db.budget.findMany({
    where: { tenantId, period: { fiscalYear: year } },
    include: {
      account: { select: { id: true, code: true, name: true, category: true } },
      period: { select: { fiscalYear: true, month: true } },
    },
    orderBy: [{ account: { code: "asc" } }, { period: { month: "asc" } }],
  });

  const years = await db.period.findMany({
    where: { tenantId },
    select: { fiscalYear: true },
    distinct: ["fiscalYear"],
    orderBy: { fiscalYear: "asc" },
  });

  const housingLoanOverlay = await computeHousingLoanOverlay(db, tenantId, year);

  return NextResponse.json({
    data: budgets,
    years: years.map((y) => y.fiscalYear),
    housingLoanOverlay,
  });
}

// 住宅ローンの月々の返済額を、連携先科目（例: 家賃）の予算に自動加算するための
// 上乗せ額を計算する（Budget テーブルは書き換えず、表示側で加算する想定）。
async function computeHousingLoanOverlay(
  db: ReturnType<typeof tenantDb>,
  tenantId: number,
  year: number,
): Promise<{ accountId: number; accountCode: string; month: number; amount: number }[]> {
  const housingLoans = await db.loan.findMany({
    where: {
      tenantId,
      loanType: "housing",
      linkedAccountId: { not: null },
      monthlyPayment: { not: null },
    },
    include: { linkedAccount: { select: { id: true, code: true } } },
  });

  const overlay: { accountId: number; accountCode: string; month: number; amount: number }[] = [];
  for (const loan of housingLoans) {
    if (!loan.linkedAccount || loan.monthlyPayment === null) continue;
    const startYm = loan.borrowedOn.getFullYear() * 12 + loan.borrowedOn.getMonth();
    const endYm = loan.repaymentDate.getFullYear() * 12 + loan.repaymentDate.getMonth();
    for (let month = 1; month <= 12; month++) {
      const ym = year * 12 + (month - 1);
      if (ym < startYm || ym > endYm) continue;
      overlay.push({
        accountId: loan.linkedAccount.id,
        accountCode: loan.linkedAccount.code,
        month,
        amount: Number(loan.monthlyPayment),
      });
    }
  }
  return overlay;
}

// POST /api/budgets … 予算の登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = BudgetSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { accountCode, fiscalYear, month, amount } = parsed.data;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);

  const account = await db.account.findUnique({
    where: { tenantId_code: { tenantId, code: accountCode } },
  });
  if (!account)
    return NextResponse.json({ error: `unknown accountCode: ${accountCode}` }, { status: 400 });

  const period = await db.period.upsert({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
    update: {},
    create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
  });

  const budget = await db.budget.upsert({
    where: {
      tenantId_accountId_periodId: { tenantId, accountId: account.id, periodId: period.id },
    },
    update: { amount },
    create: { tenantId, accountId: account.id, periodId: period.id, amount },
    include: {
      account: { select: { id: true, code: true, name: true } },
      period: { select: { fiscalYear: true, month: true } },
    },
  });

  await writeAudit(auth.user.id, "upsert", `budget:${budget.id}`);
  return NextResponse.json({ data: budget }, { status: 201 });
}
