import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import type { ForecastMethod } from "@/lib/forecast";
import {
  buildAccountTrend,
  buildMonthlyTrend,
  buildYearTrend,
  TREND_CATEGORIES,
  type CategoryAmounts,
  type TrendCategory,
} from "@/lib/monthly-trend";

// GET /api/reports/monthly-trend?period=YYYY-MM&back=6&forward=6&accountCode=&method=
//   … 対象月を中心とした前後の推移。対象月以前は実績、後ろは予測。
//     構成比グラフ（カテゴリ別）と予実対比グラフ（対象科目 + 貯蓄額）で共用する。
//
// GET /api/reports/monthly-trend?year=YYYY&method=
//   … 指定年度の 1〜12 月。実績が未入力の将来月は予測で埋める（構成比グラフの年度モード）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    year: z.coerce.number().int().min(1900).max(2999).optional(),
    back: z.coerce.number().int().min(0).max(24).default(6),
    forward: z.coerce.number().int().min(0).max(24).default(6),
    accountCode: z.string().optional(),
    method: z.string().default("moving_average"),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const method = query.method as ForecastMethod;
    const keyOf = (fiscalYear: number, month: number) =>
      `${fiscalYear}-${String(month).padStart(2, "0")}`;

    const records = await db.financialRecord.findMany({
      where: { tenantId },
      include: {
        account: { select: { id: true, code: true, category: true } },
        period: { select: { fiscalYear: true, month: true } },
      },
    });

    // 月 × カテゴリの実績（構成比と同じく絶対値。BS 科目は対象外）
    const actualByKey = new Map<string, CategoryAmounts>();
    for (const r of records) {
      const cat = r.account.category as string;
      if (!TREND_CATEGORIES.includes(cat as TrendCategory)) continue;
      const key = keyOf(r.period.fiscalYear, r.period.month);
      const row = actualByKey.get(key) ?? {};
      row[cat as TrendCategory] = (row[cat as TrendCategory] ?? 0) + Math.abs(Number(r.amount));
      actualByKey.set(key, row);
    }

    const now = new Date();
    const currentKey = keyOf(now.getFullYear(), now.getMonth() + 1);
    const periods = [...actualByKey.keys()].sort();
    // 既定は KPI カードと同じ「現在月以前で最も新しい月」
    const defaultKey =
      [...periods].reverse().find((k) => k <= currentKey) ??
      periods[periods.length - 1] ??
      currentKey;
    const center = query.period ?? defaultKey;

    // 年度モードは 1〜12 月を並べ、実績が確定している最後の月（= 既定の対象月）より後を予測で埋める。
    const months =
      query.year != null
        ? buildYearTrend(actualByKey, query.year, defaultKey, method)
        : buildMonthlyTrend(actualByKey, center, query.back, query.forward, method);

    // 予実対比グラフ用: 指定科目の予算・実績・予測
    let account: { code: string; months: ReturnType<typeof buildAccountTrend> } | null = null;
    if (query.accountCode) {
      const acct = await db.account.findUnique({
        where: { tenantId_code: { tenantId, code: query.accountCode } },
      });
      if (acct) {
        const budgetRecords = await db.budget.findMany({
          where: { tenantId, accountId: acct.id },
          include: { period: { select: { fiscalYear: true, month: true } } },
        });
        const budgetByKey = new Map(
          budgetRecords.map((b) => [keyOf(b.period.fiscalYear, b.period.month), Number(b.amount)]),
        );
        const acctActualByKey = new Map<string, number>();
        for (const r of records) {
          if (r.account.id !== acct.id) continue;
          const key = keyOf(r.period.fiscalYear, r.period.month);
          acctActualByKey.set(key, (acctActualByKey.get(key) ?? 0) + Number(r.amount));
        }
        account = {
          code: acct.code,
          months: buildAccountTrend(
            budgetByKey,
            acctActualByKey,
            center,
            query.back,
            query.forward,
            method,
          ),
        };
      }
    }

    // 年度セレクタ用の候補（実績・予算が登録されている年度）。対象月の年は常に含める。
    const periodYears = await db.period.findMany({
      where: { tenantId },
      select: { fiscalYear: true },
      distinct: ["fiscalYear"],
      orderBy: { fiscalYear: "asc" },
    });
    const years = [
      ...new Set([...periodYears.map((p) => p.fiscalYear), Number(center.slice(0, 4))]),
    ].sort((a, b) => a - b);

    return NextResponse.json({
      period: center,
      year: query.year ?? null,
      back: query.back,
      forward: query.forward,
      months,
      years,
      account,
    });
  },
});
