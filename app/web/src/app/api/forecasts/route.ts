import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregate } from "@/lib/aggregate";
import { forecast, type ForecastMethod } from "@/lib/forecast";
import { requireRole } from "@/lib/authz";

const METHODS: ForecastMethod[] = [
  "moving_average",
  "linear_regression",
  "growth_rate",
  "holt",
  "holt_winters",
];

// シナリオ係数: 楽観 / 標準 / 悲観
const SCENARIO_FACTOR = { optimistic: 1.1, base: 1.0, pessimistic: 0.9 } as const;
type Scenario = keyof typeof SCENARIO_FACTOR;

// MAPE (Mean Absolute Percentage Error)
function calcMape(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return null;
  const nonZero = actual.slice(0, n).filter((_, i) => actual[i] !== 0);
  if (nonZero.length === 0) return null;
  const sum = actual.slice(0, n).reduce((s, a, i) => {
    if (a === 0) return s;
    return s + Math.abs((a - predicted[i]) / a);
  }, 0);
  return Math.round((sum / nonZero.length) * 10000) / 100; // パーセント
}

// RMSE (Root Mean Squared Error)
function calcRmse(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return null;
  const mse = actual.slice(0, n).reduce((s, a, i) => s + Math.pow(a - predicted[i], 2), 0) / n;
  return Math.round(Math.sqrt(mse));
}

// GET /api/forecasts?accountCode=4000&months=6&method=linear_regression&scenario=base
// DB の実績（月次）を元に将来 N か月の推移を予測して返す。
// 後半 3 ヶ月をホールドアウトしてバックテスト精度（MAPE / RMSE）を算出。
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const months = Number(sp.get("months") ?? "6");
  const accountCode = sp.get("accountCode") ?? "4000";
  const method = (sp.get("method") ?? "linear_regression") as ForecastMethod;
  const scenario = (sp.get("scenario") ?? "base") as Scenario;
  const params = {
    window: sp.get("window") ? Number(sp.get("window")) : undefined,
    alpha: sp.get("alpha") ? Number(sp.get("alpha")) : undefined,
    beta: sp.get("beta") ? Number(sp.get("beta")) : undefined,
    gamma: sp.get("gamma") ? Number(sp.get("gamma")) : undefined,
    seasonLength: sp.get("seasonLength") ? Number(sp.get("seasonLength")) : undefined,
  };

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
  const forecasted = forecast(history, months, method, params).map((v) => Math.round(v * factor));

  // バックテスト精度評価: 最後の 3 ヶ月をホールドアウト
  let accuracy: { mape: number | null; rmse: number | null; holdoutMonths: number } | null = null;
  const holdout = 3;
  if (history.length > holdout + 2) {
    const trainHistory = history.slice(0, history.length - holdout);
    const actualHoldout = history.slice(history.length - holdout);
    const predictedHoldout = forecast(trainHistory, holdout, method, params);
    accuracy = {
      mape: calcMape(actualHoldout, predictedHoldout),
      rmse: calcRmse(actualHoldout, predictedHoldout),
      holdoutMonths: holdout,
    };
  }

  return NextResponse.json({
    accountCode,
    method,
    scenario,
    history: monthly,
    forecast: forecasted,
    accuracy,
  });
}

// POST /api/forecasts — 予測結果をスナップショットとして保存
// body: { accountCode, method, scenario, startYear, startMonth, values: number[] }
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    accountCode: string;
    method: string;
    scenario: string;
    startYear: number;
    startMonth: number;
    values: number[];
  };

  if (!body.accountCode || !body.values?.length) {
    return NextResponse.json({ error: "accountCode and values are required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { code: body.accountCode } });
  if (!account) {
    return NextResponse.json({ error: `account not found: ${body.accountCode}` }, { status: 404 });
  }

  const methodMap: Record<string, string> = {
    moving_average: "MOVING_AVERAGE",
    linear_regression: "LINEAR_REGRESSION",
    growth_rate: "GROWTH_RATE",
    holt: "LINEAR_REGRESSION",
    holt_winters: "LINEAR_REGRESSION",
  };
  const scenarioMap: Record<string, string> = {
    base: "BASE",
    optimistic: "OPTIMISTIC",
    pessimistic: "PESSIMISTIC",
  };

  const dbMethod = (methodMap[body.method] ?? "LINEAR_REGRESSION") as
    | "MOVING_AVERAGE"
    | "LINEAR_REGRESSION"
    | "GROWTH_RATE";
  const dbScenario = (scenarioMap[body.scenario] ?? "BASE") as
    | "BASE"
    | "OPTIMISTIC"
    | "PESSIMISTIC";

  let year = body.startYear;
  let month = body.startMonth ?? 1;

  const created: number[] = [];
  for (const amount of body.values) {
    // Period を upsert
    const period = await prisma.period.upsert({
      where: { fiscalYear_month: { fiscalYear: year, month } },
      update: {},
      create: { fiscalYear: year, month, quarter: Math.ceil(month / 3) },
    });

    const snapshot = await prisma.forecast.create({
      data: {
        accountId: account.id,
        periodId: period.id,
        method: dbMethod,
        scenario: dbScenario,
        amount: amount,
      },
    });
    created.push(snapshot.id);

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return NextResponse.json({ created: created.length, ids: created }, { status: 201 });
}
