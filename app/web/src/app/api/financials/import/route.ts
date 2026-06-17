import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// CSV の 1 行スキーマ。ヘッダ: accountCode,fiscalYear,month,amount
const RowSchema = z.object({
  accountCode: z.string().min(1),
  fiscalYear: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number(),
});

// POST /api/financials/import … CSV テキストを受け取り実績を一括登録する。
// Content-Type: text/csv（本文に CSV）を想定。
export async function POST(req: NextRequest) {
  const csv = await req.text();
  if (!csv.trim()) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const result = RowSchema.safeParse(parsed.data[i]);
    if (!result.success) {
      errors.push({ row: i + 2, message: "validation error" }); // +2: ヘッダ + 1始まり
      continue;
    }
    const { accountCode, fiscalYear, month, amount } = result.data;

    const account = await prisma.account.findUnique({ where: { code: accountCode } });
    if (!account) {
      errors.push({ row: i + 2, message: `unknown account code: ${accountCode}` });
      continue;
    }

    const period = await prisma.period.upsert({
      where: { fiscalYear_month: { fiscalYear, month } },
      update: {},
      create: { fiscalYear, month, quarter: Math.ceil(month / 3) },
    });

    await prisma.financialRecord.create({
      data: { accountId: account.id, periodId: period.id, amount },
    });
    inserted++;
  }

  return NextResponse.json({ inserted, errors }, { status: errors.length ? 207 : 201 });
}
