import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { conflict, notFound } from "@/lib/server/api-error";
import {
  buildCoverageSnapshot,
  loadActualsCoverage,
  remainingLagging,
} from "@/lib/ledger/actuals-coverage";
import { nextYearMonth } from "@/lib/shared/budget-cycle";

const ConfirmSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  /** 「当月末まで変動なし」の印を付けた口座・カード（省略時は無し） */
  noChange: z
    .array(z.object({ kind: z.enum(["bank", "card"]), id: z.number().int() }))
    .max(200)
    .default([]),
});

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// POST /api/actuals/confirm … 月の実績を確定する（editor 以上）
//   月ごとの流れ「① 予算確定 → ② 実績確定 → ③ 翌月の予算確定」の ②。
//   その月の予算が確定済みで、銀行・カード・電子マネーの明細が月末日までそろって
//   「実績入力済み」になっていること、未割り当て（科目が付いていない）の明細が残っていないことが条件
//   （lib/ledger/actuals-coverage.ts）。
//   月末まで届いていない口座・カードは、noChange（当月末まで変動なし）で指定すれば、そろったものとして扱う。
//   確定時点の明細の状況（最終日と変動なしの印）は actuals_confirmations.coverage に記録する。
//   確定後は、その月の明細の登録・削除・科目の変更と、実績（financial_records）を書く操作を受け付けない。
export const POST = withApi({
  role: "editor",
  schema: ConfirmSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const { year, month, noChange } = body;
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
    if (coverage.coveredThrough === null) {
      throw conflict(
        "銀行口座・カード・電子マネーの明細がまだありません。明細を取り込んでから確定してください",
      );
    }
    const remaining = remainingLagging(coverage, noChange);
    if (remaining.length > 0) {
      const names = remaining
        .map((r) => coverage.sources.find((s) => s.kind === r.kind && s.id === r.id))
        .map((s) => (s ? `${s.name}は${s.lastDate}まで` : null))
        .filter(Boolean)
        .join("、");
      throw conflict(
        `明細が${coverage.monthEnd}までそろっていません（${names}）。明細を取り込むか、「当月末まで変動なし」を付けてから確定してください`,
      );
    }
    // 科目が付いていない明細が残っていると、その月の実績が欠けたままになるので確定しない
    if (coverage.unassigned > 0) {
      throw conflict(
        `${label}の明細のうち ${coverage.unassigned} 件にまだ科目が付いていません。未割り当ての明細に科目を付けてから確定してください`,
      );
    }
    const snapshot = buildCoverageSnapshot(coverage.sources, coverage, noChange);

    // 二重確定は periodId の unique 制約でも止まる（同時に押された場合）
    const confirmation = await db.actualsConfirmation.create({
      data: { tenantId, periodId: period.id, confirmedById: user.id, coverage: snapshot },
    });

    await audit("actuals_confirm", `actuals:${ym(year, month)}`, {
      after: {
        coveredThrough: coverage.coveredThrough,
        unassigned: coverage.unassigned,
        noChange: snapshot.sources
          .filter((s) => s.noChange)
          .map((s) => ({ kind: s.kind, id: s.id, lastDate: s.lastDate })),
      },
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
