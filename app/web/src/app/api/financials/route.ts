import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { aggregate, type Granularity, type RecordWithPeriod } from "@/lib/aggregate";
import { resolvePeriod, requireAccountByCode } from "@/lib/period";

const FinancialRecordSchema = z.object({
  accountCode: z.string(),
  departmentId: z.number().int().optional(),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number(),
});

// GET /api/financials?granularity=month&accountCode=4000
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    granularity: z.enum(["month", "quarter", "year"]).default("month"),
    accountCode: z.string().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const granularity = query.granularity as Granularity;

    const records = await db.financialRecord.findMany({
      where: {
        tenantId,
        ...(query.accountCode ? { account: { code: query.accountCode } } : {}),
      },
      include: { period: true },
    });

    const mapped: RecordWithPeriod[] = records.map((r) => ({
      amount: Number(r.amount),
      fiscalYear: r.period.fiscalYear,
      quarter: r.period.quarter,
      month: r.period.month,
    }));

    return NextResponse.json({ granularity, data: aggregate(mapped, granularity) });
  },
});

// POST /api/financials … 実績データの登録（手入力）
export const POST = withApi({
  role: "editor",
  schema: FinancialRecordSchema,
  handler: async ({ user, db, body, audit }) => {
    const { accountCode, departmentId, fiscalYear, month, amount } = body;
    const { tenantId } = user;

    const account = await requireAccountByCode(db, tenantId, accountCode);
    const period = await resolvePeriod(db, tenantId, fiscalYear, month);

    const record = await db.financialRecord.create({
      data: { tenantId, accountId: account.id, departmentId, periodId: period.id, amount },
    });
    await db.financialRecordHistory.create({
      data: { recordId: record.id, userId: user.id, action: "create", amount },
    });
    await audit("create", `financial_record:${record.id}`);

    return NextResponse.json({ data: record }, { status: 201 });
  },
});
