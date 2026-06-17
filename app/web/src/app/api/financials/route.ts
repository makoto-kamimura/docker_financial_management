import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aggregateMonthly } from "@/lib/aggregate";

// 実績財務データ 1 件分のスキーマ
const FinancialRecordSchema = z.object({
  accountCode: z.string(),
  period: z.string(), // 例: "2025-04"
  amount: z.number(),
});

// バックエンド API: GET /api/financials
// 実績データの集計結果（月次）を返す。
// NOTE: 現状はインメモリのサンプル。Phase 1 で Prisma + PostgreSQL に置き換える。
const sampleRecords = [
  { accountCode: "4000", period: "2025-01", amount: 12_000_000 },
  { accountCode: "4000", period: "2025-02", amount: 13_500_000 },
  { accountCode: "4000", period: "2025-03", amount: 15_200_000 },
];

export async function GET() {
  const aggregated = aggregateMonthly(sampleRecords);
  return NextResponse.json({ data: aggregated });
}

// バックエンド API: POST /api/financials
// 実績データの登録（バリデーションのみのスタブ）。
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = z.array(FinancialRecordSchema).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // TODO: Prisma で永続化する
  return NextResponse.json({ inserted: parsed.data.length }, { status: 201 });
}
