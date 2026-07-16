import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { aggregate } from "@/lib/aggregate";
import {
  forecast,
  evaluateForecastAccuracy,
  toDbForecastMethod,
  toDbForecastScenario,
  type ForecastMethod,
} from "@/lib/forecast";
import { resolvePeriod } from "@/lib/period";

const METHODS = [
  "moving_average",
  "linear_regression",
  "growth_rate",
  "holt",
  "holt_winters",
] as const;

const SCENARIO_FACTOR = { optimistic: 1.1, base: 1.0, pessimistic: 0.9 } as const;

// GET /api/forecasts?accountCode=4000&months=6&method=linear_regression&scenario=base
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    months: z.coerce.number().int().min(1).max(60).default(6),
    accountCode: z.string().default("4000"),
    method: z.enum(METHODS).default("linear_regression"),
    scenario: z.enum(["optimistic", "base", "pessimistic"]).default("base"),
    window: z.coerce.number().optional(),
    alpha: z.coerce.number().optional(),
    beta: z.coerce.number().optional(),
    gamma: z.coerce.number().optional(),
    seasonLength: z.coerce.number().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { months, accountCode, scenario } = query;
    const method = query.method as ForecastMethod;
    const params = {
      window: query.window,
      alpha: query.alpha,
      beta: query.beta,
      gamma: query.gamma,
      seasonLength: query.seasonLength,
    };

    const records = await db.financialRecord.findMany({
      where: { tenantId, account: { code: accountCode } },
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
    const accuracy = evaluateForecastAccuracy(history, method, params);

    return NextResponse.json({
      accountCode,
      method,
      scenario,
      history: monthly,
      forecast: forecasted,
      accuracy,
    });
  },
});

const SnapshotSchema = z.object({
  accountCode: z.string().min(1),
  method: z.string().default("linear_regression"),
  scenario: z.string().default("base"),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12).default(1),
  values: z.array(z.number()).min(1),
});

// POST /api/forecasts — 予測結果をスナップショットとして保存
export const POST = withApi({
  role: "editor",
  schema: SnapshotSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const account = await db.account.findUnique({
      where: { tenantId_code: { tenantId, code: body.accountCode } },
    });
    if (!account) throw notFound(`account not found: ${body.accountCode}`);

    const method = toDbForecastMethod(body.method);
    const scenario = toDbForecastScenario(body.scenario);

    let year = body.startYear;
    let month = body.startMonth;

    const created: number[] = [];
    for (const amount of body.values) {
      const period = await resolvePeriod(db, tenantId, year, month);

      const snapshot = await db.forecast.create({
        data: { tenantId, accountId: account.id, periodId: period.id, method, scenario, amount },
      });
      created.push(snapshot.id);

      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }

    return NextResponse.json({ created: created.length, ids: created }, { status: 201 });
  },
});
