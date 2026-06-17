import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const PeriodSchema = z.object({
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12),
});

// GET /api/periods … 会計期間一覧
export async function GET() {
  const periods = await prisma.period.findMany({
    orderBy: [{ fiscalYear: "asc" }, { month: "asc" }],
  });
  return NextResponse.json({ data: periods });
}

// POST /api/periods … 会計期間の登録（quarter は month から自動算出）
export async function POST(req: NextRequest) {
  const parsed = PeriodSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { fiscalYear, month } = parsed.data;
  const period = await prisma.period.create({
    data: { fiscalYear, month, quarter: Math.ceil(month / 3) },
  });
  return NextResponse.json({ data: period }, { status: 201 });
}
