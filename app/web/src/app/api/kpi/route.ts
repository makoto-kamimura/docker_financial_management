import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { categoryBucket, computeLatestKpi, type MonthlyByCategory } from "@/lib/kpi";
import { requireRole } from "@/lib/authz";

// GET /api/kpi … 最新月の主要 KPI（利益率・YoY・MoM・YTD）を返す。
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const records = await prisma.financialRecord.findMany({
    where: {
      period: {
        OR: [
          { fiscalYear: { lt: currentYear } },
          { fiscalYear: currentYear, month: { lte: currentMonth } },
        ],
      },
    },
    include: { period: true, account: true },
  });

  // 月次 × カテゴリで集約
  const byKey = new Map<string, MonthlyByCategory>();
  for (const r of records) {
    const key = `${r.period.fiscalYear}-${String(r.period.month).padStart(2, "0")}`;
    const bucket = byKey.get(key) ?? { key, revenue: 0, cogs: 0, expense: 0 };
    const target = categoryBucket(r.account.category);
    if (target) bucket[target] += Number(r.amount);
    byKey.set(key, bucket);
  }

  const monthly = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const kpi = computeLatestKpi(monthly);

  return NextResponse.json({ kpi });
}
