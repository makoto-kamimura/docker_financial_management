import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregate } from "@/lib/aggregate";
import { forecast, type ForecastMethod } from "@/lib/forecast";

const METHODS: ForecastMethod[] = ["moving_average", "linear_regression", "growth_rate"];

// シナリオ係数: 楽観 / 標準 / 悲観
const SCENARIO_FACTOR = { optimistic: 1.1, base: 1.0, pessimistic: 0.9 } as const;
type Scenario = keyof typeof SCENARIO_FACTOR;

// GET /api/forecasts?accountCode=4000&months=6&method=linear_regression&scenario=base
// DB の実績（月次）を元に将来 N か月の推移を予測して返す。
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const months = Number(sp.get("months") ?? "6");
  const accountCode = sp.get("accountCode") ?? "4000";
  const method = (sp.get("method") ?? "linear_regression") as ForecastMethod;
  const scenario = (sp.get("scenario") ?? "base") as Scenario;

  if (!METHODS.includes(method)) {
    return NextResponse.json({ error: `unknown method: ${method}` }, { status: 400 });
  }

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
  const factor = SCENARIO_FACTOR[scenario] ?? 1;
  const forecasted = forecast(history, months, method).map((v) => Math.round(v * factor));

  return NextResponse.json({
    accountCode,
    method,
    scenario,
    history: monthly,
    forecast: forecasted,
  });
}
