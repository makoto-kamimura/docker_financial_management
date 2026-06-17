import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregate } from "@/lib/aggregate";
import { forecastLinear } from "@/lib/forecast";

// GET /api/forecasts?months=6&accountCode=4000
// DB の実績（月次）を元に将来 N か月の推移を線形回帰で予測して返す。
export async function GET(req: NextRequest) {
  const months = Number(req.nextUrl.searchParams.get("months") ?? "6");
  const accountCode = req.nextUrl.searchParams.get("accountCode") ?? "4000";

  const records = await prisma.financialRecord.findMany({
    where: { account: { code: accountCode } },
    include: { period: true },
  });

  const monthly = aggregate(
    records.map((r) => ({
      amount: Number(r.amount),
      fiscalYear: r.period.fiscalYear,
      quarter: r.period.quarter,
      month: r.period.month,
    })),
    "month",
  );

  const history = monthly.map((b) => b.total);
  const forecast = forecastLinear(history, months);

  return NextResponse.json({
    accountCode,
    history: monthly,
    forecast,
  });
}
