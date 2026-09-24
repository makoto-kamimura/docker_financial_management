import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { invalidateCache } from "@/lib/redis";

const UpdateSchema = z.object({
  // 金融機関から通知された、改定後の実際の月々返済額
  monthlyPayment: z.number().min(0),
});

// PATCH /api/loans/[id]/interest-rates/[changeId] … 金利改定後の実額返済額を後から入力する（editor 以上）
// 改定登録時に通知が届いていないケースのための後追い入力。最新の改定であれば
// loans.monthlyPayment にも反映し、以降の償還スケジュール・予算オーバーレイがこの額で走る。
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, params, body }) => {
    const changeId = Number(params.changeId);
    if (!Number.isInteger(changeId) || changeId <= 0) throw badRequest("invalid changeId");

    const loan = await db.loan.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!loan) throw notFound();

    const changes = await db.loanInterestRateChange.findMany({
      where: { loanId: id },
      orderBy: { effectiveOn: "asc" },
    });
    const target = changes.find((c) => c.id === changeId);
    if (!target) throw notFound();

    // より新しい適用日の改定がある場合、loans（＝現在値）は書き換えない
    const isLatest = !changes.some((c) => c.effectiveOn > target.effectiveOn);

    const updated = await db.$transaction(async (tx) => {
      const change = await tx.loanInterestRateChange.update({
        where: { id: changeId },
        data: { monthlyPayment: body.monthlyPayment },
      });
      if (isLatest) {
        await tx.loan.update({
          where: { id },
          data: { monthlyPayment: body.monthlyPayment, monthlyPaymentIsManual: true },
        });
      }
      return change;
    });

    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: updated });
  },
});
