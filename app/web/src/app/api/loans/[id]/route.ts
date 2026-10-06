import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";
import { invalidateCache } from "@/lib/redis";
import { LOAN_INCLUDE, loanBalanceAt } from "@/lib/loan-balance";

const UpdateSchema = z.object({
  lenderName: z.string().min(1).optional(),
  // 借入額・借入日（以前は資産の画面で直していた項目。借入金の入力は借入金管理に集める）
  amount: z.number().positive().optional(),
  borrowedOn: z.string().min(1).optional(),
  interestRate: z.number().min(0).optional(),
  repaymentDate: z.string().min(1).optional(), // 支払い完了年月
  note: z.string().nullable().optional(),
  loanType: z.string().optional(),
  linkedAccountCode: z.string().nullable().optional(),
  monthlyPayment: z.number().nullable().optional(),
  // 残価設定ローンの据置額（最終回に一括支払い）。カーローン等
  residualValue: z.number().min(0).nullable().optional(),
  // この借入で買った資産の付け替え（null で外す）。資産はローンの無いものだけ選べる
  assetId: z.number().int().nullable().optional(),
});

// PATCH /api/loans/[id] … 借入条件の編集（借入額・借入日・金利・支払い完了年月・月々の返済額・連携科目・資産 等）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.loan.findUnique({
      where: { id, tenantId },
      include: { repayments: { select: { principal: true } } },
    });
    if (!existing) throw notFound();

    if (body.assetId !== undefined && body.assetId !== null) {
      const target = await db.personalAsset.findFirst({ where: { id: body.assetId, tenantId } });
      if (!target) throw badRequest(`invalid assetId: ${body.assetId}`);
      if (target.loanId !== null && target.loanId !== id) {
        throw badRequest("この資産には、ほかの借入がひも付いています");
      }
    }
    // 借入額を直したら、残高も「借入額 − 返した元金の合計」に合わせる
    const repaid = existing.repayments.reduce((sum, r) => sum + Number(r.principal), 0);

    let linkedAccountId: number | null | undefined = undefined;
    if (body.linkedAccountCode !== undefined) {
      if (body.linkedAccountCode === null) {
        linkedAccountId = null;
      } else {
        const account = await findAccountByCode(db, tenantId, body.linkedAccountCode);
        if (!account) throw badRequest(`unknown linkedAccountCode: ${body.linkedAccountCode}`);
        linkedAccountId = account.id;
      }
    }

    const loan = await db.$transaction(async (tx) => {
      if (body.assetId !== undefined) {
        // 今ひも付いている資産を外してから、選んだ資産にひも付ける
        await tx.personalAsset.updateMany({
          where: { tenantId, loanId: id },
          data: { loanId: null },
        });
        if (body.assetId !== null) {
          await tx.personalAsset.update({ where: { id: body.assetId }, data: { loanId: id } });
        }
      }
      return tx.loan.update({
        where: { id },
        data: {
          ...(body.lenderName !== undefined && { lenderName: body.lenderName }),
          ...(body.amount !== undefined && {
            amount: body.amount,
            remainingAmount: Math.max(0, body.amount - repaid),
          }),
          ...(body.borrowedOn !== undefined && { borrowedOn: new Date(body.borrowedOn) }),
          ...(body.interestRate !== undefined && { interestRate: body.interestRate }),
          ...(body.repaymentDate !== undefined && { repaymentDate: new Date(body.repaymentDate) }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.loanType !== undefined && { loanType: body.loanType }),
          ...(linkedAccountId !== undefined && { linkedAccountId }),
          ...(body.residualValue !== undefined && { residualValue: body.residualValue }),
          // 人が金額を入れた＝実額。以降は自動計算で上書きしない（クリア時はフラグも戻す）
          ...(body.monthlyPayment !== undefined && {
            monthlyPayment: body.monthlyPayment,
            monthlyPaymentIsManual: body.monthlyPayment !== null,
          }),
        },
        include: LOAN_INCLUDE,
      });
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({
      data: { ...loan, remainingAmount: String(loanBalanceAt(loan, new Date())) },
    });
  },
});
