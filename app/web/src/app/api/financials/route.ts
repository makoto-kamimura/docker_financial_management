import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { aggregate, type Granularity, type RecordWithPeriod } from "@/lib/aggregate";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

// 実績データ 1 件分のスキーマ
const FinancialRecordSchema = z.object({
  accountCode: z.string(),
  departmentId: z.number().int().optional(),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number(),
});

// GET /api/financials?granularity=month&accountCode=4000
// 実績データを指定粒度で集計して返す。
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const granularity = (req.nextUrl.searchParams.get("granularity") ?? "month") as Granularity;
  const accountCode = req.nextUrl.searchParams.get("accountCode") ?? undefined;

  const records = await prisma.financialRecord.findMany({
    where: accountCode ? { account: { code: accountCode } } : undefined,
    include: { period: true },
  });

  const mapped: RecordWithPeriod[] = records.map((r) => ({
    amount: Number(r.amount),
    fiscalYear: r.period.fiscalYear,
    quarter: r.period.quarter,
    month: r.period.month,
  }));

  return NextResponse.json({ granularity, data: aggregate(mapped, granularity) });
}

// POST /api/financials … 実績データの登録（手入力）。
// 勘定科目コードと会計期間を解決し、存在しない期間は作成する。
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = FinancialRecordSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { accountCode, departmentId, fiscalYear, month, amount } = parsed.data;

  const account = await prisma.account.findUnique({ where: { code: accountCode } });
  if (!account) {
    return NextResponse.json({ error: `unknown account code: ${accountCode}` }, { status: 400 });
  }

  const period = await prisma.period.upsert({
    where: { fiscalYear_month: { fiscalYear, month } },
    update: {},
    create: { fiscalYear, month, quarter: Math.ceil(month / 3) },
  });

  const record = await prisma.financialRecord.create({
    data: { accountId: account.id, departmentId, periodId: period.id, amount },
  });
  await writeAudit(auth.user.id, "create", `financial_record:${record.id}`);

  return NextResponse.json({ data: record }, { status: 201 });
}
