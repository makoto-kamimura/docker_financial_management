import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { invalidateCache } from "@/lib/redis";
import { recalcMonthlyPaymentAtRateChange, ymIndex } from "@/lib/debt-schedule";
import type { Loan, LoanInterestRateChange } from "@prisma/client";

const RateChangeSchema = z.object({
  effectiveOn: z.string().min(1), // 金利変更日
  // 変更後の年利。loans.interestRate と同じく小数で受け取る（0.015 = 1.5%）
  interestRate: z.number().min(0).max(1),
  // 改定後の月々の返済額（実額）。省略／null は「通知待ち」として履歴に未入力で積む。
  // 5 年ルールのローンは金利が変わっても返済額が据え置かれるため、計算値では代用できない。
  monthlyPayment: z.number().min(0).nullable().optional(),
  note: z.string().optional(),
});

// 当初金利（%）。最初の改定の「変更前金利」＝借入時の金利。改定が無ければ現在の金利
function originalRatePercent(loan: Loan, changes: LoanInterestRateChange[]): number {
  const first = [...changes].sort((a, b) => a.effectiveOn.getTime() - b.effectiveOn.getTime())[0];
  return Number(first ? first.previousRate : loan.interestRate) * 100;
}

// 「残高 × 残回数」による参考月額。算出できない場合は null
function calcReference(
  loan: Loan,
  changes: LoanInterestRateChange[],
  effectiveOn: Date,
  newRate: number,
) {
  const priorChanges = changes
    .filter((c) => c.effectiveOn < effectiveOn)
    .map((c) => ({ effectiveYm: ymIndex(c.effectiveOn), rate: Number(c.interestRate) * 100 }));
  return recalcMonthlyPaymentAtRateChange({
    principal: Number(loan.amount),
    borrowedOn: loan.borrowedOn,
    repaymentDate: loan.repaymentDate,
    baseRatePercent: originalRatePercent(loan, changes),
    priorChanges,
    monthlyPayment: loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined,
    effectiveOn,
    newRatePercent: newRate * 100,
    residualValue: Number(loan.residualValue ?? 0),
  });
}

// GET /api/loans/[id]/interest-rates … 金利変更履歴（適用日の昇順）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const loan = await db.loan.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!loan) throw notFound();

    const changes = await db.loanInterestRateChange.findMany({
      where: { loanId: id },
      orderBy: { effectiveOn: "asc" },
    });
    return NextResponse.json({ data: changes });
  },
});

// POST /api/loans/[id]/interest-rates … 金利変更の登録（editor 以上）
// 履歴を1行積み、その変更が最新（＝以降により新しい適用日が無い）なら loans.interestRate も更新する。
// 月々の返済額は「実額が入力されたときだけ」loans.monthlyPayment へ反映する。計算値では上書きしない
// （5 年ルールのローンは金利改定後も返済額が据え置かれるため）。参考値は履歴に残して UI で示す。
export const POST = withApi({
  role: "editor",
  schema: RateChangeSchema,
  handler: async ({ user, db, id, body }) => {
    const loan = await db.loan.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!loan) throw notFound();

    const effectiveOn = new Date(body.effectiveOn);
    if (Number.isNaN(effectiveOn.getTime())) throw badRequest("invalid effectiveOn");

    const existing = await db.loanInterestRateChange.findMany({
      where: { loanId: id },
      orderBy: { effectiveOn: "asc" },
    });
    if (existing.some((c) => c.effectiveOn.getTime() === effectiveOn.getTime())) {
      throw badRequest("同じ適用日の金利変更が既に登録されています");
    }

    // 変更前金利＝適用日の直前まで有効だった金利（履歴が無ければ当初金利）
    const prior = existing.filter((c) => c.effectiveOn < effectiveOn).at(-1);
    const previousRate = prior ? Number(prior.interestRate) : Number(loan.interestRate);
    // この変更より後の適用日がある場合、loans.interestRate（＝現在の金利）は書き換えない
    const isLatest = !existing.some((c) => c.effectiveOn > effectiveOn);

    const reference = calcReference(loan, existing, effectiveOn, body.interestRate);
    const actual = body.monthlyPayment ?? null;

    const change = await db.$transaction(async (tx) => {
      const created = await tx.loanInterestRateChange.create({
        data: {
          loanId: id,
          effectiveOn,
          interestRate: body.interestRate,
          previousRate,
          monthlyPayment: actual,
          previousMonthlyPayment: loan.monthlyPayment,
          calculatedMonthlyPayment: reference?.monthly ?? null,
          note: body.note ?? null,
        },
      });
      if (isLatest) {
        await tx.loan.update({
          where: { id },
          data: {
            interestRate: body.interestRate,
            // 実額が入力されたときだけ返済額を更新する（未入力なら従来の額を据え置き）
            ...(actual !== null && { monthlyPayment: actual, monthlyPaymentIsManual: true }),
          },
        });
      }
      return created;
    });

    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: change, reference: reference ?? null }, { status: 201 });
  },
});
