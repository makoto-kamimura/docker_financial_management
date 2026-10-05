import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";
import { loadActualsCoverage } from "@/lib/actuals-coverage";
import { nextYearMonth } from "@/lib/budget-cycle";

const YearMonthSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// POST /api/actuals/confirm … 月の実績を確定する（editor 以上）
//   月ごとの流れ「① 予算確定 → ② 実績確定 → ③ 翌月の予算確定」の ②。
//   その月の予算が確定済みで、銀行・カード・電子マネーの明細が月末日までそろって
//   「実績入力済み」になっていることが条件（lib/actuals-coverage.ts）。
//   確定後は、その月の実績（financial_records）の登録・変更・削除・明細の転記を受け付けない。
export const POST = withApi({
  role: "editor",
  schema: YearMonthSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const { year, month } = body;
    const label = `${year}年${month}月`;

    const period = await db.period.findUnique({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
      include: { budgetConfirmation: true, actualsConfirmation: true },
    });
    if (!period?.budgetConfirmation) {
      throw conflict(`${label}の予算が確定していません。先に予算を確定してください`);
    }
    if (period.actualsConfirmation) throw conflict(`${label}の実績はすでに確定済みです`);

    const coverage = await loadActualsCoverage(db, tenantId, year, month);
    if (!coverage.entered) {
      throw conflict(
        coverage.coveredThrough
          ? `明細が${coverage.monthEnd}までそろっていません（いちばん遅いものは${coverage.coveredThrough}まで）。明細を取り込んでから確定してください`
          : "銀行口座・カード・電子マネーの明細がまだありません。明細を取り込んでから確定してください",
      );
    }

    // 二重確定は periodId の unique 制約でも止まる（同時に押された場合）
    const confirmation = await db.actualsConfirmation.create({
      data: { tenantId, periodId: period.id, confirmedById: user.id },
    });

    await audit("actuals_confirm", `actuals:${ym(year, month)}`, {
      after: { coveredThrough: coverage.coveredThrough, unposted: coverage.unposted },
    });
    return NextResponse.json(
      { data: { year, month, confirmedAt: confirmation.confirmedAt } },
      { status: 201 },
    );
  },
});

// DELETE /api/actuals/confirm?year=&month= … 実績の確定の解除（admin のみ）
//   確定と逆の順でしか外せない: 翌月の予算が確定済みなら、先にそちらを解除する。
export const DELETE = withApi({
  role: "admin",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const { year, month } = query;
    const next = nextYearMonth(year, month);

    const [period, nextPeriod] = await Promise.all([
      db.period.findUnique({
        where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
        include: { actualsConfirmation: true },
      }),
      db.period.findUnique({
        where: {
          tenantId_fiscalYear_month: { tenantId, fiscalYear: next.year, month: next.month },
        },
        include: { budgetConfirmation: true },
      }),
    ]);
    if (!period?.actualsConfirmation) {
      throw notFound(`${year}年${month}月の実績は確定されていません`);
    }
    if (nextPeriod?.budgetConfirmation) {
      throw conflict(
        `${next.year}年${next.month}月の予算が確定済みのため解除できません。先に${next.month}月の予算の確定を解除してください`,
      );
    }

    await db.actualsConfirmation.delete({ where: { periodId: period.id } });
    await audit("actuals_unconfirm", `actuals:${ym(year, month)}`, {
      before: { confirmedAt: period.actualsConfirmation.confirmedAt.toISOString() },
    });
    return new NextResponse(null, { status: 204 });
  },
});
